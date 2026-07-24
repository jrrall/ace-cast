"""Feed parsers (no network): Reddit JSON and RSS/Atom -> FeedItems."""

from __future__ import annotations

from forge.feeds import _parse_reddit, _parse_rss


def test_parse_reddit_listing():
    body = {
        "data": {
            "children": [
                {"data": {"title": "First meme", "permalink": "/r/x/1"}},
                {"data": {"title": "  ", "permalink": "/r/x/2"}},  # blank dropped
                {"data": {"title": "Second meme"}},
            ]
        }
    }
    items = _parse_reddit(body, source="r/memes")
    assert [i.title for i in items] == ["First meme", "Second meme"]
    assert items[0].url == "/r/x/1"


def test_parse_rss():
    xml = """<?xml version="1.0"?>
    <rss><channel>
      <item><title>Headline one</title></item>
      <item><title>Headline two</title></item>
    </channel></rss>"""
    items = _parse_rss(xml, source="news")
    assert [i.title for i in items] == ["Headline one", "Headline two"]


def test_parse_atom():
    xml = """<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry><title>Atom one</title></entry>
    </feed>"""
    items = _parse_rss(xml, source="atom")
    assert [i.title for i in items] == ["Atom one"]
