"""Bounded public b3ta research: topic pages and their discussion threads."""
from __future__ import annotations

import random
import re
from urllib.parse import urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup

from .logging_setup import get_logger

SOURCE = "b3ta forum anecdotes"
DEFAULT_URL = "https://b3ta.com/questions/imagechallenge/"
LOG = get_logger("forge.b3ta")


def topic_url(url: str) -> bool:
    parsed = urlsplit(url)
    return (parsed.scheme == "https" and parsed.netloc == "b3ta.com"
            and not parsed.query and not parsed.fragment
            and re.fullmatch(r"/questions/[a-z0-9_-]+/", parsed.path) is not None)


def _links(soup, base: str, suffix: str) -> list[str]:
    # Only follow topic-local reading URLs, never profile/posting/external links.
    pattern = re.compile(re.escape(base) + suffix)
    return list(dict.fromkeys(urljoin(base, a["href"]).split("#")[0]
                             for a in soup.select("a[href]")
                             if pattern.fullmatch(urljoin(base, a["href"]).split("#")[0])))


def posts(html: str, base: str) -> list[dict]:
    result = []
    for node in BeautifulSoup(html, "html.parser").select('div[id^="answers-post-"]'):
        identifier = node.get("id", "").removeprefix("answers-post-")
        if not identifier.isdigit():
            continue
        title = node.find("b")
        title = title.get_text(" ", strip=True) if title else ""
        # Byline starts the author, signature, date, and reply controls. Keep only
        # preceding content, including line breaks important to lists of puns.
        byline = node.select_one(".byline")
        if byline:
            for sibling in list(byline.next_siblings):
                sibling.extract()
            byline.decompose()
        for noise in node.select("script, style, img, .usersig"):
            noise.decompose()
        text = node.get_text("\n", strip=True).rstrip(" \n(")[:1800]
        if text:
            result.append({"id": identifier, "title": title or text.splitlines()[0][:160],
                           "text": text, "url": base + "post" + identifier})
    return result


def collect(html: str, base: str, client: httpx.Client, *, rng=random) -> list[dict]:
    """At most one extra archive page and three reply threads (five requests total)."""
    if not topic_url(base):
        raise ValueError("b3ta requires a canonical HTTPS question topic URL")

    def fetch(url):
        try:
            response = client.get(url, follow_redirects=False)
            response.raise_for_status()
            return response.text
        except httpx.HTTPError as exc:
            LOG.warning("feed.b3ta_page_failed", extra={"extra_fields": {"url": url, "error": str(exc)}})
            return ""

    pages = [html]
    archive_links = _links(BeautifulSoup(html, "html.parser"), base, r"page\d+/")
    if archive_links:
        archived = fetch(rng.choice(archive_links))
        if archived:
            pages.append(archived)
    pool = {post["id"]: post for page in pages for post in posts(page, base)}
    sampled = rng.sample(list(pool.values()), min(8, len(pool)))
    expandable = set()
    for page in pages:
        soup = BeautifulSoup(page, "html.parser")
        for link in soup.select("a.reply_post_link_class[href]"):
            url = urljoin(base, link["href"]).split("#")[0]
            if (re.fullmatch(re.escape(base) + r"post\d+", url)
                    and re.search(r"\d+\s+repl", link.get_text())):
                expandable.add(url)
    remaining = 3
    for post in sampled:
        source_posts = [dict(post)]
        if remaining and post["url"] in expandable:
            remaining -= 1
            discussion = posts(fetch(post["url"]), base)
            source_posts += [p for p in discussion if p["id"] != post["id"]]
            replies = [p["text"][:400] for p in discussion if p["id"] != post["id"]][:8]
            if replies:
                post["text"] += "\nReplies (same discussion):\n" + "\n---\n".join(replies)
        post["finds"] = [{"text": line.strip(), "url": p["url"]}
                         for p in source_posts for line in p["text"].splitlines()
                         if 2 <= len(line.strip()) <= 100 and 1 <= len(line.split()) <= 8
                         and "____" not in line][:40]
        post["text"] = ("Unverified forum humor, not factual reporting.\n" + post["text"])[:5000]
    LOG.info("feed.b3ta_sample", extra={"extra_fields": {"url": base, "posts": len(sampled)}})
    return sampled
