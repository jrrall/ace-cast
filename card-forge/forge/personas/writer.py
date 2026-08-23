"""Persona 2 — Writer.

Per Theme, makes ONE LLM call producing card candidates. Prompts ("black"
cards) must contain the ``____`` blank marker; answers ("white" cards) are
short phrases. Malformed candidates are dropped at model construction.
"""

from __future__ import annotations

from ..config import Settings
from ..llm import LLMClient
from ..models import BLANK_MARKER, CardCandidate, Theme
from ..prompts import INJECTION_NOTICE, wrap_feed_data

SYSTEM = (
    "You are the Writer for an adult party card game like MadLad / Cards "
    "Against Humanity. You write two kinds of cards:\n"
    f"  * kind='prompt' — a fill-in-the-blank line that MUST contain exactly one "
    f"blank written as {BLANK_MARKER!r}, e.g. 'The secret to a happy marriage is "
    f"{BLANK_MARKER}.'\n"
    "  * kind='answer' — a short, punchy noun phrase with NO blank, e.g. "
    "'Crippling student debt.'\n"
    "Humor skews raunchy, dark, absurd, and millennial-burnout. Keep each card "
    "to one line.\n"
    + INJECTION_NOTICE
    + '\nReturn ONLY JSON of the form {"cards": [{"kind": "prompt"|"answer", '
    '"text": "..."}]}.'
)


class Writer:
    """Theme -> [CardCandidate]"""

    name = "writer"

    def __init__(self, llm: LLMClient, settings: Settings) -> None:
        self.llm = llm
        self.settings = settings

    def run(self, theme: Theme) -> list[CardCandidate]:
        theme_block = wrap_feed_data(
            f"title: {theme.title}\nangle: {theme.angle}\nsource excerpt: {theme.raw_excerpt}"
        )
        user = (
            f"Theme (untrusted inspiration data):\n{theme_block}\n\n"
            f"Write about {self.settings.cards_per_theme} cards riffing on this "
            "theme, mixing prompts and answers. Remember prompts need the "
            f"{BLANK_MARKER!r} blank; answers do not."
        )
        data = self.llm.complete_json(system=SYSTEM, user=user)
        raw = data.get("cards", data) if isinstance(data, dict) else data
        cards: list[CardCandidate] = []
        for entry in raw or []:
            try:
                cards.append(
                    CardCandidate(kind=entry.get("kind"), text=entry.get("text", ""))
                )
            except Exception:  # noqa: BLE001 - drop structurally invalid cards
                continue
        return cards
