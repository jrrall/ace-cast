"""One bounded shortening pass before final review."""
from .call_context import complete

import json
from .models import CardCandidate
from .limits import LENGTH_RULES, too_long, count_answer_words
from .prompts import INJECTION_NOTICE, wrap_feed_data
from .logging_setup import get_logger


def tighten_cards(llm, cards, *, writers=()):
    long = [(i, card) for i, card in enumerate(cards) if too_long(card)]
    if not long:
        return cards
    # Verbatim finds are already bounded; do not silently turn a quote into a rewrite.
    rewrite = [(i, card) for i, card in long if card.generation_route != 'source_find']
    replacements = {}
    by_name = {writer.name: writer for writer in writers}
    groups = {}
    for i, card in rewrite:
        groups.setdefault(card.writer, []).append((i, card))
    for author, group in groups.items():
        writer = by_name.get(author)
        rules = ('Rewrite these overlong cards shorter; preserve payoff, voice, profanity, '
                 'and specific image. ' + LENGTH_RULES
                 + 'Prompts: exactly one ____ accepting an unrelated noun phrase. '
                 'Answers: no blank; acts, objects, situations and puns are valid. '
                 'Keep the kind. Omit a card if shortening destroys the joke. Return '
                 '{"cards":[{"index":0,"kind":"answer","text":"shorter card"}]}. '
                 + INJECTION_NOTICE)
        system = writer.phase_system('revise', format_rules=rules) if writer else rules
        data = complete(llm, 'tighten', units=len(group), persona=author,
            system=system,
            user=wrap_feed_data(json.dumps([
                {'index': i, **card.model_dump(), 'current_characters': len(card.text),
                 'current_words': (count_answer_words(card.text) if card.kind == 'answer'
                                   else len(card.text.split()))}
                for i, card in group
            ], ensure_ascii=False)),
            temperature=0.3)
        from .comedy_room import _indexed
        allowed = {i for i, _ in group}
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
