"""Persona 3 — Editor.

One LLM call to cull broken/unfunny cards and within-batch duplicates and to
tighten wording. The Editor returns a (usually smaller) list of candidates.
Structural validity is re-enforced on construction, and any within-batch exact
duplicates that survive are removed deterministically.
"""

from __future__ import annotations

from ..config import Settings
from ..llm import LLMClient
from ..models import BLANK_MARKER, CardCandidate

SYSTEM = (
    "You are the Editor for an adult party card game. You receive draft cards "
    "and return a tightened set. Rules:\n"
    "  * Drop cards that are unfunny, incoherent, or off-format.\n"
    "  * Drop near-duplicates within the set.\n"
    f"  * A kind='prompt' card MUST keep exactly one {BLANK_MARKER!r} blank; a "
    "kind='answer' card must have none.\n"
    "  * Fix light wording but preserve the joke; do not invent brand-new cards.\n"
    'Return ONLY JSON of the form {"cards": [{"kind": "...", "text": "..."}]}.'
)


class Editor:
    """[CardCandidate] -> [CardCandidate]"""

    name = "editor"

    def __init__(self, llm: LLMClient, settings: Settings) -> None:
        self.llm = llm
        self.settings = settings

    def run(self, candidates: list[CardCandidate]) -> list[CardCandidate]:
        if not candidates:
            return []
        listing = "\n".join(
            f'{i}. [{c.kind}] {c.text}' for i, c in enumerate(candidates)
        )
        user = (
            "Draft cards to edit:\n"
            f"{listing}\n\n"
            "Return the polished, de-duplicated subset."
        )
        data = self.llm.complete_json(system=SYSTEM, user=user, temperature=0.4)
        raw = data.get("cards", data) if isinstance(data, dict) else data
        seen: set[tuple[str, str]] = set()
        edited: list[CardCandidate] = []
        for entry in raw or []:
            try:
                card = CardCandidate(kind=entry.get("kind"), text=entry.get("text", ""))
            except Exception:  # noqa: BLE001 - drop invalid
                continue
            key = (card.kind, card.text.lower())
            if key in seen:
                continue
            seen.add(key)
            edited.append(card)
        return edited
