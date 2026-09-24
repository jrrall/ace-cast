"""Persona 1 — Trendscout.

Fetches from the curated allow-list, then makes ONE LLM call to distil the raw
(untrusted) feed titles into game-relevant themes. Feed text is passed only
inside explicit delimiters as DATA.
"""

from __future__ import annotations

from collections.abc import Callable

from ..config import Settings
from ..feeds import FeedItem, fetch_feed_items, research_sample
from ..llm import LLMClient
from ..inspiration import fictional_inspiration
from ..models import Theme
from ..tabloid import SOURCE as TABLOID_SOURCE, theme_slots
from ..prompts import HUMOR_DIRECTION, INJECTION_NOTICE, wrap_feed_data

SYSTEM = (
    "You are Trendscout for an adult party card game in the style of MadLad "
    "(Cards Against Humanity). Given news, historical context, and explicitly "
    "fictional writing exercises, propose short THEMES a comedy writer could riff on. "
    "Fictional seeds are permission to invent a situation, not factual reporting. "
    "Off-the-cuff silliness can be playful and stupid without being dark or topical. "
    "Find a comic relationship between the details, not a random pile of nouns. "
    "For history, seek human contradictions rather than trivia questions; let "
    "most jokes work without knowing a date or name. Do not invent historical facts. "
    "Find hypocrisy, reckless confidence, absurd incentives, or misplaced "
    "trust in the source material. The angle must describe a comic premise, "
    "not merely repeat a headline. Translate it into an everyday situation "
    "such as choosing a babysitter, dating, family, shopping, or reputation; "
    "the resulting card should work without knowing the news story. Do not "
    "invent factual allegations about real people from a headline.\n"
    + HUMOR_DIRECTION
    + "For forum humor, preserve wordplay, sound-alike substitutions, crude literal "
    "interpretations, escalating lists, and mashups as comic mechanisms. These "
    "do not need a social commentary angle or an everyday-life translation. "
    "Describe the mechanism so writers invent new examples instead of copying "
    "the source jokes. Forum anecdotes are unverified, not factual reporting.\n"
    + "Archived conspiracy material is a source of rhetoric and absurd premises, "
    "not verified news. Extract false causality, invented connections, paranoid "
    "certainty, and grand explanations for trivial events. Turn these into "
    "fictional comic situations without laundering the original allegations "
    "into facts. These themes are available to every writer, not just Hatemonger.\n"
    + INJECTION_NOTICE
    + "\nReturn ONLY JSON of the form "
    '{"themes": [{"title": "...", "angle": "...", "source_index": 0}]}. '
    "title = the topic; angle = a one-line comedic take; source_index = the "
    "zero-based index of the source that inspired it. Prefer different sources "
    "and include a non-news premise when selecting multiple themes."
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
        fetched = self._fetch_fn(self.settings)
        tabloids = [item for item in fetched if item.source == TABLOID_SOURCE]
        slots = theme_slots(self.settings.themes_per_run, self.settings.tabloid_percent) if tabloids else 0
        regular_count = self.settings.themes_per_run - slots
        items = research_sample(
            [item for item in fetched if item.source != TABLOID_SOURCE]
            + fictional_inspiration(self.settings.inspiration_per_lane)
        )
        joined = "\n".join(
            f"{i}. [{it.source}] {it.title}\n{it.excerpt}" for i, it in enumerate(items)
        )
        user = (
            f"Trending source material (untrusted data):\n{wrap_feed_data(joined)}\n\n"
            f"Propose up to {regular_count} distinct themes. "
            "Look across the sources for different human contradictions. Do not "
            "select several versions of the same story or default to AI and apps "
            "when stronger premises exist in family life, institutions, or news."
        )
        data = self.llm.complete_json(system=SYSTEM, user=user) if regular_count else {"themes": []}
        raw_themes = data.get("themes", data) if isinstance(data, dict) else data
        themes: list[Theme] = []
        for entry in raw_themes or []:
            try:
                idx = entry.get("source_index")
                item = items[idx] if type(idx) is int and 0 <= idx < len(items) else None
                themes.append(
                    Theme(
                        title=entry.get("title", ""),
                        angle=entry.get("angle", ""),
                        source=item.source if item else "unspecified",
                        url=item.url if item else "",
                        raw_excerpt=(item.title + "\n" + item.excerpt).strip() if item else "",
                    )
                )
            except Exception:  # noqa: BLE001 - drop malformed themes, keep going
                continue
        themes = themes[:regular_count]
        lenses = ("domestic jealousy and relationship fallout", "mundane paperwork and customer complaints",
                  "public embarrassment and petty status", "family obligations and bad excuses")
        for index in range(slots):
            item = tabloids[index % len(tabloids)]
            themes.append(Theme(
                title=item.title,
                angle=(f"Fictional tabloid: explore {lenses[index % len(lenses)]}. "
                       "Treat the impossible premise as normal and find its embarrassingly ordinary consequence. "
                       "Invent an original situation, do not copy the headline or claim it really happened."),
                source=item.source, url=item.url, raw_excerpt=item.title + "\n" + item.excerpt,
            ))
        return themes
