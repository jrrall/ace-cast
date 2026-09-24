"""One bounded archive fetch; dated fictional tabloid inspiration, never news."""
from datetime import date, datetime
from html.parser import HTMLParser
import random
from urllib.parse import urlparse

ARCHIVE_URL = 'https://weeklyworldnews.com/archive/'
SOURCE = 'fictional:weekly-world-news'


class ArchiveParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.year = None
        self.day = ''
        self.capture = None
        self.parts = []
        self.url = ''
        self.rows = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        identifier = attrs.get('id', '')
        if tag == 'a' and identifier.startswith('year') and identifier[4:].isdigit():
            self.year = int(identifier[4:])
        classes = attrs.get('class', '').split()
        if 'sya_date' in classes:
            self.capture, self.parts = 'date', []
        if tag == 'a' and 'sya_postlink' in classes:
            self.capture, self.parts = 'title', []
            self.url = attrs.get('href', '')

    def handle_data(self, data):
        if self.capture:
            self.parts.append(data)

    def handle_endtag(self, tag):
        if self.capture == 'date' and tag == 'span':
            self.day = ''.join(self.parts).strip()
            self.capture = None
        elif self.capture == 'title' and tag == 'a':
            title = ''.join(self.parts).strip()
            try:
                published = datetime.strptime(f'{self.year} {self.day}', '%Y %B %d').date()
                if title and urlparse(self.url).hostname == 'weeklyworldnews.com':
                    self.rows.append((published, title, self.url))
            except ValueError:
                pass
            self.capture = None


def archive_pick(html, today=None, rng=None):
    """Choose a matching month/day, uniformly by available past year, then story.

    If no exact anniversary exists, choose within the same month and label it.
    No matching month returns None rather than inventing an archival date.
    """
    today, rng = today or date.today(), rng or random.Random()
    parser = ArchiveParser()
    parser.feed(html)
    past = [r for r in parser.rows if r[0].year < today.year]
    pool = [r for r in past if (r[0].month, r[0].day) == (today.month, today.day)]
    match = 'same month/day'
    if not pool:
        pool = [r for r in past if r[0].month == today.month]
        match = 'same-month fallback (no exact anniversary)'
    if not pool:
        return None
    year = rng.choice(sorted({r[0].year for r in pool}))
    published, title, url = rng.choice([r for r in pool if r[0].year == year])
    return published, title, url, match


def theme_slots(total, percent, rng=None):
    """Stochastic rounding keeps one-theme runs near the requested long-run share."""
    rng = rng or random.Random()
    expected = max(0, total) * percent / 100
    whole = int(expected)
    return whole + int(rng.random() < expected - whole)
