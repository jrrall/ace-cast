"""Feed parsers (no network): Reddit JSON and RSS/Atom -> FeedItems."""

from __future__ import annotations

import httpx
import pytest

from forge.config import load_settings
from forge.feeds import FeedError, _parse_reddit, _parse_rss, fetch_feed_items


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


class _FakeResponse:
    def __init__(self, status_code=200, text="", payload=None, ctype="application/json"):
        self.status_code = status_code
        self.text = text
        self._payload = payload
        self.headers = {"content-type": ctype}

    def json(self):
        return self._payload


class _FakeClient:
    """Maps url -> _FakeResponse or an exception to raise."""

    def __init__(self, routes):
        self.routes = routes
        self.seen = []

    def get(self, url):
        self.seen.append(url)
        result = self.routes[url]
        if isinstance(result, Exception):
            raise result
        return result


def _settings_with(urls):
    return load_settings(feed_allowlist=",".join(urls))


def test_one_dead_source_does_not_sink_the_run():
    """Reddit 403s datacentre IPs; the RSS source alone must still carry the run."""
    dead = "https://www.reddit.com/r/memes/top.json"
    alive = "https://feeds.example.com/news.xml"
    client = _FakeClient(
        {
            dead: _FakeResponse(status_code=403),
            alive: _FakeResponse(
                text="<rss><channel><item><title>Still here</title></item></channel></rss>",
                ctype="application/xml",
            ),
        }
    )
    items = fetch_feed_items(_settings_with([dead, alive]), http=client)
    assert [i.title for i in items] == ["Still here"]
    assert client.seen == [dead, alive]  # the dead source did not short-circuit


def test_failed_source_is_logged_with_url_and_reason(caplog):
    """Ops needs to know WHICH feed died and why -- a bare warning is useless."""
    dead = "https://www.reddit.com/r/memes/top.json"
    alive = "https://feeds.example.com/news.xml"
    client = _FakeClient(
        {
            dead: _FakeResponse(status_code=403),
            alive: _FakeResponse(
                text="<rss><channel><item><title>Still here</title></item></channel></rss>",
                ctype="application/xml",
            ),
        }
    )
    with caplog.at_level("WARNING", logger="forge.feeds"):
        fetch_feed_items(_settings_with([dead, alive]), http=client)
    fields = [getattr(r, "extra_fields", {}) for r in caplog.records]
    assert any(f.get("url") == dead and "403" in f.get("error", "") for f in fields)


def test_transport_error_is_also_survivable():
    dead = "https://down.example.com/feed.xml"
    alive = "https://feeds.example.com/news.xml"
    client = _FakeClient(
        {
            dead: httpx.ConnectError("no route to host"),
            alive: _FakeResponse(
                text="<rss><channel><item><title>Survivor</title></item></channel></rss>",
                ctype="application/xml",
            ),
        }
    )
    items = fetch_feed_items(_settings_with([dead, alive]), http=client)
    assert [i.title for i in items] == ["Survivor"]


def test_all_sources_dead_still_fails_closed():
    """Fail-closed is the point: zero items must abort, and name every failure."""
    a = "https://a.example.com/feed.xml"
    b = "https://b.example.com/feed.json"
    client = _FakeClient({a: _FakeResponse(status_code=500), b: _FakeResponse(status_code=403)})
    with pytest.raises(FeedError) as exc:
        fetch_feed_items(_settings_with([a, b]), http=client)
    assert "500" in str(exc.value) and "403" in str(exc.value)
