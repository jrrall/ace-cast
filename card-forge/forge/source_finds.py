"""Select short, verbatim b3ta finds by index, never model-invented quotations."""
import json
from .models import CardCandidate
from .prompts import INJECTION_NOTICE, wrap_feed_data
from .logging_setup import get_logger


def find_cards(llm, items, limit=6):
    pool = []
    seen = set()
    for item in items:
        for find in item.finds:
            key = (find['text'], find['url'])
            if key not in seen:
                pool.append(find)
                seen.add(key)
    pool = pool[:80]
    if not pool or limit == 0:
        return []
    data = llm.complete_json(
        system=('Pick short found phrases that already work as funny standalone answer cards. '
                'Puns, rude name mashups, and stupid concrete images are valid jokes; they do '
                'not need an elaborate reversal or social commentary. Select up to the limit '
                'or none. Do not rewrite or complete a phrase. Return {"selected":[0,1]} '
                'using the supplied zero-based indexes. ' + INJECTION_NOTICE),
        user=f'Limit: {limit}\n' + wrap_feed_data(json.dumps(pool, ensure_ascii=False)), temperature=0.3)
    selected = data.get('selected') if isinstance(data, dict) else None
    if not isinstance(selected, list):
        raise ValueError('source finds requires selected indexes')
    cards, used, counts = [], set(), {}
    for idx in selected:
        if type(idx) is not int or idx < 0 or idx >= len(pool) or idx in used:
            continue
        used.add(idx)
        row = pool[idx]
        # At most two brief phrases from any post, never an entire joke list.
        if counts.get(row['url'], 0) >= 2:
            continue
        try:
            card = CardCandidate(kind='answer', text=row['text'], generation_route='source_find', source_url=row['url'])
        except ValueError:
            continue
        if card.text != row['text']:
            continue  # A found phrase must survive formatting verbatim.
        counts[row['url']] = counts.get(row['url'], 0) + 1
        cards.append(card)
        get_logger().info('source.find', extra={'extra_fields': card.model_dump()})
        if len(cards) >= limit:
            break
    return cards
