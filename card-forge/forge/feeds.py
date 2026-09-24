"""Fetching from the curated source ALLOWLIST.

Configured b3ta topics additionally allow bounded topic-local archive/reply reads.
Other sources fetch only URLs present in ``Settings.feed_urls``. Two formats are
understood out of the box: Reddit-style listing JSON and RSS/Atom XML. Every
returned item's ``text`` is untrusted DATA — callers must delimit it, never
treat it as instructions.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from itertools import zip_longest
from html.parser import HTMLParser

import httpx

from .config import Settings
from .b3ta import topic_url, collect, SOURCE as B3TA_SOURCE
from .tabloid import ARCHIVE_URL, SOURCE, archive_pick
from .logging_setup import get_logger

LOG = get_logger("forge.feeds")


class FeedError(RuntimeError):
    """Raised when an allow-listed source cannot be fetched or parsed."""


@dataclass
class FeedItem:
    title: str
    source: str
    url: str = ""
    excerpt: str = ""


def research_sample(items: list[FeedItem], limit: int = 60) -> list[FeedItem]:
    """Interleave sources so an early, prolific feed cannot monopolize research."""
    if limit <= 0:
        return []
    sources: dict[str, list[FeedItem]] = {}
    for item in items:
        sources.setdefault(item.source, []).append(item)
    selected: list[FeedItem] = []
    seen: set[str] = set()
    for row in zip_longest(*sources.values()):
        for item in row:
            if item is None:
                continue
            key = " ".join(item.title.casefold().split())
            if key in seen:
                continue
            seen.add(key)
            selected.append(item)
            if len(selected) == limit:
                return selected
    return selected


class _PlainText(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def _parse_history(body: dict, source: str) -> list[FeedItem]:
    """Library of Congress collection JSON includes article context inline."""
    items = []
    for row in body.get("results", [])[:5]:
        parser = _PlainText()
        for article in row.get("item", {}).get("articles", []):
            parser.feed(article)
        title = row.get("title") or "; ".join(row.get("description", []))
        if title:
            items.append(FeedItem(title=title, source=source, url=row.get("id", ""),
                                  excerpt=" ".join(" ".join(parser.parts).split())[:1200]))
    return items


def _parse_reddit(body: dict, source: str) -> list[FeedItem]:
    items: list[FeedItem] = []
    for child in body.get("data", {}).get("children", []):
        data = child.get("data", {})
        title = (data.get("title") or "").strip()
        if title:
            items.append(
                FeedItem(
                    title=title,
                    source=source,
                    url=data.get("permalink", "") or data.get("url", ""),
                )
            )
    return items


def _parse_rss(text: str, source: str) -> list[FeedItem]:
    items: list[FeedItem] = []
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise FeedError(f"invalid RSS/Atom from {source}: {exc}") from exc
    # RSS <item><title>, Atom <entry><title>
    for tag in (".//item", ".//{http://www.w3.org/2005/Atom}entry"):
        for node in root.findall(tag):
            title_node = node.find("title")
            if title_node is None:
                title_node = node.find("{http://www.w3.org/2005/Atom}title")
            title = (title_node.text or "").strip() if title_node is not None else ""
            if title:
                items.append(FeedItem(title=title, source=source))
    return items


def fetch_feed_items(settings: Settings, http: httpx.Client | None = None) -> list[FeedItem]:
    """Fetch and normalise every allow-listed source into flat ``FeedItem``s."""
    owns_client = http is None
    client = http or httpx.Client(
        timeout=settings.feed_timeout,
        headers={"User-Agent": settings.feed_user_agent},
        follow_redirects=True,
    )
    items: list[FeedItem] = []
    failures: list[str] = []
    try:
        for url in settings.feed_urls:
            if url == ARCHIVE_URL and settings.tabloid_percent == 0:
                continue
            # A single dead source must not sink the run: public feeds rate-limit
            # (Reddit 403s datacentre IPs) and go down. Record the failure, keep
            # going, and let the "nothing at all" check below stay fail-closed.
            try:
                resp = client.get(url, follow_redirects=False) if topic_url(url) else client.get(url)
                if resp.status_code != 200:
                    raise FeedError(f"{url} -> HTTP {resp.status_code}")
                ctype = resp.headers.get("content-type", "")
                body_text = resp.text
                if topic_url(url):
                    items.extend(FeedItem(title=p["title"], source=B3TA_SOURCE, url=p["url"],
                                          excerpt=p["text"]) for p in collect(body_text, url, client))
                elif url == ARCHIVE_URL:
                    selected = archive_pick(body_text)
                    if selected:
                        published, title, link, match = selected
                        items.append(FeedItem(title=title, source=SOURCE, url=link,
                                              excerpt=f"Fictional tabloid inspiration. Published {published}; {match}. "
                                              "Impossible events treated as ordinary domestic problems. Not factual news."))
                    else:
                        LOG.warning("feed.tabloid_no_date_match")
                elif "json" in ctype or url.rstrip("/").endswith(".json") or ".json?" in url:
                    body = resp.json()
                    if isinstance(body, dict) and "results" in body:
                        items.extend(_parse_history(body, source=url))
                    else:
                        items.extend(_parse_reddit(body, source=url))
                else:
                    items.extend(_parse_rss(body_text, source=url))
            except (httpx.HTTPError, FeedError, ValueError) as exc:
                LOG.warning(
                    "feed.source_failed",
                    extra={"extra_fields": {"url": url, "error": str(exc)}},
                )
                failures.append(f"{url}: {exc}")
    finally:
        if owns_client:
            client.close()
    if not items:
        detail = "; ".join(failures) if failures else "all sources returned zero items"
        raise FeedError(f"no items fetched from any allow-listed source ({detail})")
    return items
