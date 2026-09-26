"""Persona 3 — Editor.

Bounded sequential LLM calls tighten wording and remove broken cards and
duplicates, leaving subjective humor decisions to human review. The Editor returns a (usually smaller) list of candidates.
Structural validity is re-enforced on construction, and any within-batch exact
duplicates that survive are removed deterministically.
"""

from __future__ import annotations

from ..call_context import complete

from ..logging_setup import get_logger
from ..config import Settings
from ..llm import LLMClient
from ..models import BLANK_MARKER, CardCandidate
from ..prompts import maturity_direction

SYSTEM = (
    "Copy-edit party cards. Preserve each persona's premise, voice, and intentional wording; "
    "fix wording and format without adding jokes or a house style.\n"
    "Cut research attribution, planning commentary, and explanations of the joke. "
    "Keep the concrete premise in one compact setup or phrase that stands alone.\n"
    "Keep distinct playable drafts for human review regardless of taste. Drop only "
    "irreparably unplayable cards or duplicates sharing both situation and payoff.\n"
    f"Prompts: exactly one {BLANK_MARKER!r} accepting unrelated noun phrases. "
    "Answers: standalone noun phrases, no blank or dependence on the source headline. "
    "Preserve kind; never invent or merge cards.\n"
    'Return only {"cards": [{"source_index": 0, "kind": "...", "text": "..."}]}, '
    "using each draft's zero-based source_index."
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
        edited: list[CardCandidate] = []
        seen: set[tuple[str, str]] = set()
        size = self.settings.editor_batch_size
        for start in range(0, len(candidates), size):
            chunk = candidates[start:start + size]
            get_logger().info("editor.batch_started", extra={"extra_fields": {
                "offset": start, "cards": len(chunk), "total": len(candidates),
            }})
            for card in self._edit_batch(chunk, offset=start):
                key = (card.kind, card.text.lower())
                if key not in seen:
                    seen.add(key)
                    edited.append(card)
            get_logger().info("editor.batch_completed", extra={"extra_fields": {
                "offset": start, "edited_so_far": len(edited),
            }})
        return edited

    def _edit_batch(self, candidates: list[CardCandidate], *, offset=0) -> list[CardCandidate]:
        # source_index is local to this chunk; resolve provenance before merging.
        listing = "\n".join(
            f'{i}. [{c.kind}] {c.text}' for i, c in enumerate(candidates)
        )
        user = (
            "Draft cards to edit:\n"
            f"{listing}\n\n"
            "Return the polished, de-duplicated subset."
        )
        data = complete(self.llm, "editor", units=len(candidates), batch=offset, system=SYSTEM + maturity_direction(self.settings.maturity_max), user=user, temperature=0.4)
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
            if source is not None:
                card.generation_route = source.generation_route
                card.source_url = source.source_url
            key = (card.kind, card.text.lower())
            if key in seen:
                continue
            seen.add(key)
            edited.append(card)
        return edited
