"""Persona 3 — Editor.

One LLM call to cull broken/unfunny cards and within-batch duplicates and to
tighten wording. The Editor returns a (usually smaller) list of candidates.
Structural validity is re-enforced on construction, and any within-batch exact
duplicates that survive are removed deterministically.
"""

from __future__ import annotations

from ..logging_setup import get_logger
from ..config import Settings
from ..llm import LLMClient
from ..models import BLANK_MARKER, CardCandidate
from ..prompts import maturity_direction, HUMOR_DIRECTION
from ..rubric import RUBRIC

SYSTEM = (
    "You are the Editor for an adult party card game. You receive draft cards "
    "and return a tightened set.\n"
    + HUMOR_DIRECTION + RUBRIC
    + "Drafts come from Deadpan, Unhinged, PR Spin Doctor, Petty Villain, and Banned From the Thread writers. Preserve each joke's "
    "delivery: do not inflate understatement or flatten a coherent wild "
    "escalation into a polite observation. Preserve cheerful PR spin and "
    "self-justifying pettiness rather than rewriting everything as dry absurdity. "
    "Keep inventive abrasive insults and self-own reversals sharp rather "
    "than sanitizing them into polite observations. Preserve the shock comic's "
    "crude forum voice, abrupt filthy images, blasphemy, and ugly confessions. "
    "Keep purposeful vulgar wording; do not replace it with polite euphemisms "
    "or require a wholesome setup before a nasty payoff. Judge "
    "whether the joke works, not whether it is polite. Cut rants and offensive "
    "references that have no actual comic turn. "
    "Judge all voices by playability.\n"
    "Rules:\n"
    "  * Drop cards that are unfunny, incoherent, or off-format.\n"
    "  * Group drafts by situation and comic mechanism BEFORE polishing. Keep at "
    "most the strongest card from each repeated setup, even when wording, blank "
    "placement, or writer voice differs. Five headline paraphrases are one joke.\n"
    "  * Reject headline summaries with blanks, random-object whimsy, and setups "
    "whose answer merely labels a genre or object without creating a comic turn. "
    "Prefer a laugh followed by an uncomfortable realization over harmless "
    "quirkiness. Do not force shock into a joke that already works.\n"
    "  * Return fewer cards or an empty list when necessary. Never fill a quota "
    "or rescue weak drafts by rewriting them into the same safe premise.\n"
    f"  * A kind='prompt' card MUST keep exactly one {BLANK_MARKER!r} blank; a "
    "kind='answer' card must have none.\n"
    "  * Test every prompt with unrelated noun phrases such as 'a sponsored apology' "
    "and 'my landlord'. Rewrite or drop prompts requiring a verb or a specific "
    "matching answer. Answers must stand alone without the source headline. "
    "Rewrite complete-sentence answers into noun phrases: for example, "
    "'He apologized with an ad' becomes 'An apology sponsored by a betting app'.\n"
    "  * Preserve concrete surprises and sharp punchlines; do not flatten "
    "them into generic observations or stock burnout jokes.\n"
    "  * Preserve each card's kind; never turn answers into prompts or vice versa.\n"
    "  * Fix light wording but preserve the joke; do not invent brand-new cards.\n"
    "  * Return source_index, the zero-based draft number, for every edited card. "
    "Keep a single source per card; do not merge jokes from different drafts.\n"
    'Return ONLY JSON of the form {"cards": [{"source_index": 0, "kind": "...", "text": "..."}]}.'
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
        data = self.llm.complete_json(system=SYSTEM + maturity_direction(self.settings.maturity_max), user=user, temperature=0.4)
        raw = data.get("cards", data) if isinstance(data, dict) else data
        seen: set[tuple[str, str]] = set()
        edited: list[CardCandidate] = []
        for entry in raw or []:
            try:
                card = CardCandidate(kind=entry.get("kind"), text=entry.get("text", ""))
            except Exception:  # noqa: BLE001 - drop invalid
                continue
            source = None
            if "source_index" in entry:
                idx = entry["source_index"]
                if type(idx) is not int or not 0 <= idx < len(candidates):
                    get_logger().warning("editor.invalid_source_index")
                    continue
                source = candidates[idx]
                if source.kind != card.kind:
                    continue
            else:
                # Compatibility for unchanged drafts; never infer a writer for
                # rewritten or ambiguous text when the model omits its index.
                matches = [c for c in candidates if c.kind == card.kind and c.text == card.text]
                if len(matches) == 1:
                    source = matches[0]
                elif any(c.writer is not None for c in candidates):
                    get_logger().warning("editor.unattributed_draft_dropped")
                    continue
            card.writer = source.writer if source is not None else None
            key = (card.kind, card.text.lower())
            if key in seen:
                continue
            seen.add(key)
            edited.append(card)
        return edited
