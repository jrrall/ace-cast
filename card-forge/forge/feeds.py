"""Fetching from the curated source ALLOWLIST.

Only URLs present in ``Settings.feed_urls`` are ever fetched. Two formats are
understood out of the box: Reddit-style listing JSON and RSS/Atom XML. Every
returned item's ``text`` is untrusted DATA — callers must delimit it, never
treat it as instructions.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass

import httpx

from .config import Settings
from .logging_setup import get_logger

LOG = get_logger("forge.feeds")


class FeedError(RuntimeError):
    """Raised when an allow-listed source cannot be fetched or parsed."""


@dataclass
class FeedItem:
    title: str
    source: str
    url: str = ""


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
            # A single dead source must not sink the run: public feeds rate-limit
            # (Reddit 403s datacentre IPs) and go down. Record the failure, keep
            # going, and let the "nothing at all" check below stay fail-closed.
            try:
                resp = client.get(url)
                if resp.status_code != 200:
                    raise FeedError(f"{url} -> HTTP {resp.status_code}")
                ctype = resp.headers.get("content-type", "")
                body_text = resp.text
                if "json" in ctype or url.rstrip("/").endswith(".json") or ".json?" in url:
                    items.extend(_parse_reddit(resp.json(), source=url))
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
