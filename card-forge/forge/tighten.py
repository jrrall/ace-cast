"""One bounded shortening pass before final review."""
import json
from .models import CardCandidate
from .prompts import INJECTION_NOTICE, wrap_feed_data
from .logging_setup import get_logger

LIMITS = {'prompt': (24, 160), 'answer': (12, 90)}


def too_long(card):
    words, chars = LIMITS[card.kind]
    return len(card.text.split()) > words or len(card.text) > chars


def tighten_cards(llm, cards):
    long = [(i, card) for i, card in enumerate(cards) if too_long(card)]
    if not long:
        return cards
    # Verbatim finds are already bounded; do not silently turn a quote into a rewrite.
    rewrite = [(i, card) for i, card in long if card.generation_route != 'source_find']
    replacements = {}
    if rewrite:
        data = llm.complete_json(
            system=('Shorten supplied cards; preserve payoff, voice, profanity, and specific image. '
                    'Prompts: at most 24 words and 160 characters, exactly one ____ accepting '
                    'an unrelated noun phrase. Answers: at most 12 words and 90 characters, '
                    'no blank; acts, objects, situations and puns are valid. Keep the kind. '
                    'Omit a card if shortening destroys the joke. Return '
                    '{"cards":[{"index":0,"kind":"answer","text":"shorter card"}]}. '
                    + INJECTION_NOTICE),
            user=wrap_feed_data(json.dumps([{'index': i, **card.model_dump()} for i, card in rewrite], ensure_ascii=False)),
            temperature=0.3)
        from .comedy_room import _indexed
        allowed = {i for i, _ in rewrite}
        for idx, row in _indexed(data, 'cards', len(cards)).items():
            if idx not in allowed:
                continue
            try:
                card = CardCandidate(kind=row.get('kind'), text=row.get('text'),
                    writer=cards[idx].writer, generation_route=cards[idx].generation_route,
                    source_url=cards[idx].source_url)
            except (ValueError, TypeError):
                continue
            if (card.kind == cards[idx].kind and not too_long(card)
                    and (card.kind == 'answer' or card.blanks == 1)):
                replacements[idx] = card
    result = []
    for i, card in enumerate(cards):
        if not too_long(card):
            result.append(card)
            continue
        shorter = replacements.get(i)
        get_logger().info('review.shorten', extra={'extra_fields': {
            'original': card.model_dump(), 'revision': shorter.model_dump() if shorter else None,
            'kept': shorter is not None}})
        if shorter:
            result.append(shorter)
    return result
