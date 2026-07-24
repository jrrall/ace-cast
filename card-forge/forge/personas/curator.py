"""Persona 5 — Curator.

Fetches the existing corpus (ALL statuses incl. denied) via the content API,
drops near-duplicates against it and within the batch, then makes ONE LLM call
to rank/select the strongest cards into a 10-20 item ``SubmitBatch``.

Agent dedupe (fuzzy, normalised text) and server dedupe (exact ``(pack_id,text)``)
are complementary: the agent trims obvious dups pre-flight; the server is the
authoritative guard. Both include denied text so denied cards never re-flood
the review queue.
"""

from __future__ import annotations

from ..client import ContentClient
from ..config import Settings
from ..llm import LLMClient
from ..models import ModeratedCard, SubmitBatch, SubmitCard
from ..text import normalize_text

SYSTEM = (
    "You are the Curator for an adult party card game. From a numbered list of "
    "vetted cards, select the funniest, most varied set to publish. Prefer a "
    "mix of prompts and answers and avoid repetitive jokes.\n"
    'Return ONLY JSON of the form {"selected": [0, 2, 5]} listing the indexes '
    "to keep, best first."
)


class Curator:
    """[ModeratedCard] -> SubmitBatch"""

    name = "curator"

    def __init__(
        self, llm: LLMClient, content: ContentClient, settings: Settings
    ) -> None:
        self.llm = llm
        self.content = content
        self.settings = settings

    def _existing_norms(self) -> set[str]:
        # ALL statuses (incl. denied) so denied text is treated as a duplicate
        corpus = self.content.list_cards()
        return {normalize_text(c.get("text", "")) for c in corpus if c.get("text")}

    def run(self, moderated: list[ModeratedCard]) -> SubmitBatch:
        pack = self.settings.pack_slug
        if not moderated:
            return SubmitBatch(cards=[], pack=pack)

        existing = self._existing_norms()
        seen: set[str] = set()
        pool: list[ModeratedCard] = []
        for card in moderated:
            norm = normalize_text(card.text)
            if norm in existing or norm in seen:
                continue  # drop near-duplicate (incl. against denied corpus)
            seen.add(norm)
            pool.append(card)

        if not pool:
            return SubmitBatch(cards=[], pack=pack)

        listing = "\n".join(
            f'{i}. [{c.kind}] {c.text}' for i, c in enumerate(pool)
        )
        user = (
            f"Vetted cards:\n{listing}\n\n"
            f"Select up to {self.settings.batch_max} to publish."
        )
        data = self.llm.complete_json(system=SYSTEM, user=user, temperature=0.3)
        raw = data.get("selected", data) if isinstance(data, dict) else data

        order: list[int] = []
        for idx in raw or []:
            try:
                i = int(idx)
            except (TypeError, ValueError):
                continue
            if 0 <= i < len(pool) and i not in order:
                order.append(i)
        if not order:
            # curation ranking unavailable -> fall back to moderated order;
            # the pool is already vetted and deduped, so this is safe.
            order = list(range(len(pool)))

        chosen = [pool[i] for i in order][: self.settings.batch_max]
        cards = [SubmitCard.from_moderated(c, pack) for c in chosen]
        return SubmitBatch(cards=cards, pack=pack)
