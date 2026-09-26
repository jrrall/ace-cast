"""Lossless research records and bounded JSON views for scout requests."""
import hashlib
import json

from .models import Theme


def stories_from_items(items):
    stories = {}
    for item in items:
        fields = dict(source=item.source, title=item.title, url=item.url, excerpt=item.excerpt)
        digest = hashlib.sha256(json.dumps(fields, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        key = 'story-' + digest
        stories.setdefault(key, {'id': key, **fields})
    return list(stories.values())


def request_payload(stories, *, max_themes, excerpt_chars=800, tabloid_percent=25):
    return {
        'stories': [dict(id=s['id'], source=s['source'][:160], title=s['title'][:300],
                         excerpt=s['excerpt'][:excerpt_chars]) for s in stories],
        'max_themes': max_themes, 'tabloid_preference_percent': tabloid_percent,
    }


def resolve_themes(data, stories, limit):
    rows = data.get('themes') if isinstance(data, dict) else None
    if not isinstance(rows, list):
        raise ValueError('themes must be a list')
    # Excess output must not invalidate otherwise valid requested selections.
    by_id = {s['id']: s for s in stories}
    seen, themes = set(), []
    for row in rows[:limit]:
        if not isinstance(row, dict):
            raise ValueError('theme must be an object')
        key = row.get('story_id')
        if not isinstance(key, str) or key not in by_id or key in seen:
            raise ValueError('story_id must be unique and belong to the submitted stories')
        if any(not isinstance(row.get(k), str) or not row[k].strip() for k in ('title', 'angle')):
            raise ValueError('title and angle must be nonblank strings')
        seen.add(key)
        story = by_id[key]
        themes.append(Theme(title=row['title'], angle=row['angle'], source=story['source'],
                            url=story['url'], raw_excerpt=(story['title']+'\n'+story['excerpt']).strip()))
    return themes
