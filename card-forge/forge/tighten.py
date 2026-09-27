"""Persona shortening with one bounded repair attempt for invalid revisions."""
from .call_context import complete

import json
import re
from .models import CardCandidate
from .limits import (LENGTH_RULES, too_long, count_answer_words,
                     PROMPT_MAX_CHARS, ANSWER_MAX_WORDS, ANSWER_MAX_CHARS)
from .prompts import MADLIB_RULES, INJECTION_NOTICE, wrap_feed_data
from .logging_setup import get_logger


def _limits(card):
    return ({'characters': PROMPT_MAX_CHARS} if card.kind == 'prompt' else
            {'characters': ANSWER_MAX_CHARS, 'non_filler_words': ANSWER_MAX_WORDS})


def _revision(row, original):
    # Kind is source metadata, not generated text. Retain compatibility with
    # old responses, but never accept an explicit prompt/answer kind change.
    kind = row.get('kind')
    if kind in ('prompt', 'answer') and kind != original.kind:
        return None, f'kind_changed: must remain {original.kind}'
    try:
        card = CardCandidate(kind=original.kind, text=row.get('text'),
                             writer=original.writer, generation_route=original.generation_route,
                             source_url=original.source_url)
    except (ValueError, TypeError):
        return None, 'invalid_shape: preserve the source kind and its blank requirements'
    if card.kind == 'prompt' and re.findall(r'_+', card.text) != ['____']:
        return None, 'invalid_blank: use exactly one four-underscore blank'
    if too_long(card):
        return None, (f'too_long: {len(card.text)} characters, '
                      f'{count_answer_words(card.text)} non-filler words; limits {_limits(card)}')
    return card, None


def tighten_cards(llm, cards, *, writers=()):
    long = [(i, card) for i, card in enumerate(cards) if too_long(card)]
    if not long:
        return cards
    replacements, failures, attempts = {}, {}, {}
    by_name = {writer.name: writer for writer in writers}
    groups = {}
    for i, card in long:
        if card.generation_route == 'source_find':
            failures[i] = 'overlong_source_find: verbatim quotations cannot be rewritten'
        else:
            groups.setdefault(card.writer, []).append((i, card))
    for author, group in groups.items():
        writer = by_name.get(author)
        rules = ('Shorten supplied cards while preserving the premise and voice. '
                 + LENGTH_RULES + MADLIB_RULES
                 + 'Answers must be standalone noun phrases, not completed prompt sentences. '
                 'Compress the idea when deleting a few words is insufficient. '
                 'Return {"cards":[{"index":0,"text":"shorter card"}]}, copying supplied indexes. '
                 'Code preserves kind; do not return a kind field. '
                 'Omit a card if shortening destroys the joke. ' + INJECTION_NOTICE)
        system = writer.phase_system('revise', format_rules=rules) if writer else rules
        system += ' Length repair is required: do not keep an unchanged over-limit card.'
        pending, feedback = group, {}
        for attempt in range(2):
            request = [dict(index=i, **card.model_dump(), limits=_limits(card),
                            current_characters=len(card.text),
                            current_words=(count_answer_words(card.text) if card.kind == 'answer'
                                           else len(card.text.split())),
                            **feedback.get(i, {})) for i, card in pending]
            data = complete(llm, 'tighten', units=len(pending), persona=author,
                system=system,
                user=wrap_feed_data(json.dumps(request, ensure_ascii=False)),
                temperature=0.3 if attempt == 0 else 0.0)
            from .comedy_room import _indexed
            rows = _indexed(data, 'cards', len(cards))
            retry = []
            for idx, original in pending:
                attempts[idx] = attempt + 1
                row = rows.get(idx)
                if row is None:
                    failures[idx] = 'omitted: no unique revision for this index'
                    continue
                card, error = _revision(row, original)
                if card is not None:
                    replacements[idx] = card
                    failures.pop(idx, None)
                    continue
                failures[idx] = error
                feedback[idx] = {'previous_revision': row, 'validation_error': error}
                retry.append((idx, original))
                get_logger().info('review.shorten_rejected', extra={'extra_fields': {
                    'index': idx, 'writer': author, 'attempt': attempt + 1,
                    'reason': error, 'proposed_text': row.get('text')}})
            if not retry:
                break
            pending = retry
    result = []
    for i, card in enumerate(cards):
        if not too_long(card):
            result.append(card)
            continue
        shorter = replacements.get(i)
        get_logger().info('review.shorten', extra={'extra_fields': {
            'original': card.model_dump(), 'revision': shorter.model_dump() if shorter else None,
            'kept': shorter is not None, 'attempts': attempts.get(i, 0),
            'reason': 'shortened' if shorter else failures.get(i, 'no_valid_revision')}})
        if shorter:
            result.append(shorter)
    return result
