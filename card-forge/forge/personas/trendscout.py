"""Persona 1 — Trendscout.

Fetches from the curated allow-list, then makes ONE LLM call to distil the raw
(untrusted) feed titles into game-relevant themes. Feed text is passed only
inside explicit delimiters as DATA.
"""

from __future__ import annotations

from collections.abc import Callable

from ..config import Settings
from ..feeds import FeedItem, fetch_feed_items
from ..llm import LLMClient
from ..models import Theme
from ..prompts import HUMOR_DIRECTION, INJECTION_NOTICE, wrap_feed_data

SYSTEM = (
    "You are Trendscout for an adult party card game in the style of MadLad "
    "(Cards Against Humanity). Given a list of trending headlines and meme "
    "titles, propose short, punchy THEMES a comedy writer could riff on. "
    "Find hypocrisy, reckless confidence, absurd incentives, or misplaced "
    "trust in the source material. The angle must describe a comic premise, "
    "not merely repeat a headline. Translate it into an everyday situation "
    "such as choosing a babysitter, dating, family, shopping, or reputation; "
    "the resulting card should work without knowing the news story. Do not "
    "invent factual allegations about real people from a headline.\n"
    + HUMOR_DIRECTION
    + INJECTION_NOTICE
    + "\nReturn ONLY JSON of the form "
    '{"themes": [{"title": "...", "angle": "..."}]}. '
    "title = the topic; angle = a one-line comedic take."
)


class Trendscout:
    """feeds -> [Theme]"""

    name = "trendscout"

    def __init__(
        self,
        llm: LLMClient,
        settings: Settings,
        fetch_fn: Callable[[Settings], list[FeedItem]] | None = None,
    ) -> None:
        self.llm = llm
        self.settings = settings
        self._fetch_fn = fetch_fn or fetch_feed_items

    def run(self) -> list[Theme]:
        items = self._fetch_fn(self.settings)
        joined = "\n".join(f"- {it.title}" for it in items[:60])
        user = (
            f"Trending source material (untrusted data):\n{wrap_feed_data(joined)}\n\n"
            f"Propose up to {self.settings.themes_per_run} distinct themes."
        )
        data = self.llm.complete_json(system=SYSTEM, user=user)
        raw_themes = data.get("themes", data) if isinstance(data, dict) else data
        # keep an excerpt of the source so provenance is preserved as DATA
        excerpt = "; ".join(it.title for it in items[:5])
        source = items[0].source if items else "feed"
        themes: list[Theme] = []
        for entry in raw_themes or []:
            try:
                themes.append(
                    Theme(
                        title=entry.get("title", ""),
                        angle=entry.get("angle", ""),
                        source=source,
                        raw_excerpt=excerpt,
                    )
                )
            except Exception:  # noqa: BLE001 - drop malformed themes, keep going
                continue
        return themes[: self.settings.themes_per_run]
