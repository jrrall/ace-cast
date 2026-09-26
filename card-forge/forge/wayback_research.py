"""Sample archived Infowars claims as material for fictional conspiracy satire."""
from datetime import date
import random
import re
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
from bs4 import BeautifulSoup

from .logging_setup import get_logger

FEED_URL = 'https://archive.org/wayback/available?url=infowars.com'
SOURCE = 'Archived Infowars conspiracy claims'
LOG = get_logger('forge.wayback')
ORIGIN = 'http://www.infowars.com/'


def original_url(url):
    p = urlsplit(url)
    if (p.scheme not in ('http', 'https') or p.hostname not in ('infowars.com', 'www.infowars.com')
            or p.username or p.password or p.port not in (None, 80, 443)):
        raise ValueError('unapproved original archive host')
    return urlunsplit((p.scheme, p.netloc, p.path or '/', p.query, ''))


def snapshot_url(url):
    p = urlsplit(url)
    match = re.fullmatch(r'/web/(\d{14})(?:id_)?/(https?://.+)', p.path + ('?' + p.query if p.query else ''))
    if p.netloc != 'web.archive.org' or p.scheme not in ('http', 'https') or not match:
        raise ValueError('invalid archive snapshot URL')
    stamp, origin = match.groups()
    if not 2000 <= int(stamp[:4]) <= 2009:
        raise ValueError('snapshot is outside the configured 2000–2009 era')
    return f'https://web.archive.org/web/{stamp}id_/{original_url(origin)}'


def fetch_snapshot(client, url):
    url = snapshot_url(url)
    for _ in range(3):
        response = client.get(url, follow_redirects=False)
        if response.is_redirect:
            url = snapshot_url(urljoin(url, response.headers.get('location', '')))
            continue
        response.raise_for_status()
        return response.text, url
    raise ValueError('too many archive redirects')


def article_links(html, origin=ORIGIN):
    links = {}
    for anchor in BeautifulSoup(html, 'html.parser').select('a[href]'):
        title = ' '.join(anchor.get_text(' ', strip=True).split())
        if len(title.split()) < 6 or len(title) > 300:
            continue
        try:
            url = original_url(urljoin(origin, anchor['href']))
        except ValueError:
            continue
        if urlsplit(url).path in ('/', '/index.html'):
            continue
        links.setdefault(url, title)
    return list(links.items())


def article_text(html):
    soup = BeautifulSoup(html, 'html.parser')
    for node in soup.select('script, style, nav, header, footer, form, aside'):
        node.decompose()
    root = soup.select_one('article, .entry-content, #article') or soup
    paragraphs = [' '.join(p.get_text(' ', strip=True).split()) for p in root.select('p')]
    return '\n'.join(dict.fromkeys(p for p in paragraphs if len(p) >= 80))[:3500]


def archive_day(*, today=None, rng=random):
    """Same month/day in a random eligible year; Feb 29 uses leap years only."""
    today = today or date.today()
    choices = []
    for year in range(2000, 2010):
        try:
            choices.append(date(year, today.month, today.day))
        except ValueError:
            continue
    return rng.choice(choices)


def collect(client, *, rng=random, today=None):
    day = archive_day(today=today, rng=rng)
    response = client.get(FEED_URL, params={'url': 'infowars.com', 'timestamp': day.strftime('%Y%m%d')}, follow_redirects=False)
    response.raise_for_status()
    closest = response.json().get('archived_snapshots', {}).get('closest', {})
    if not closest.get('available') or str(closest.get('status')) != '200':
        raise ValueError('no available Infowars snapshot')
    requested = day.strftime('%Y%m%d')
    candidate = snapshot_url(closest.get('url', ''))
    if candidate.split('/web/')[1][:8] != requested:
        raise ValueError(f'no snapshot for this day in selected year: {day}; nearest capture differs')
    html, homepage = fetch_snapshot(client, candidate)
    if homepage.split('/web/')[1][:8] != requested:
        raise ValueError(f'archive redirected away from requested day: {day}')
    stamp = homepage.split('/web/')[1][:14]
    origin = homepage.split('id_/', 1)[1]
    candidates = article_links(html, origin)
    result = []
    for url, title in rng.sample(candidates, min(2, len(candidates))):
        archived = f'https://web.archive.org/web/{stamp}id_/{url}'
        text = ''
        try:
            article, archived = fetch_snapshot(client, archived)
            text = article_text(article)
        except (httpx.HTTPError, ValueError) as exc:
            LOG.warning('feed.archive_article_failed', extra={'extra_fields': {'url': archived, 'error': str(exc)}})
        result.append({'title': title, 'url': archived if text else homepage,
                       'excerpt': f'Archived conspiracy claims, not verified facts. Snapshot {stamp[:8]}. '
                       'Do not repeat allegations as facts.\n'
                       + (text or 'Headline only; article body unavailable.')})
    if not result:
        raise ValueError('archive page contained no usable article links')
    LOG.info('feed.archive_sample', extra={'extra_fields': {'snapshot': homepage, 'articles': len(result)}})
    return result
