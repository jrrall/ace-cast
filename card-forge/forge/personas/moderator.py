"""Persona 4 — Moderator.

One LLM call to assign a maturity rating (0-3) and a policy verdict per card.
Then a deterministic, defence-in-depth pass:
  * drop cards the model flagged as out-of-policy,
  * drop cards whose maturity exceeds the target pack's ``maturity_max`` (cap),
  * drop cards containing any configured deny-list term (independent of the LLM,
    so a prompt-injected model that emits banned content is still caught).
"""

from __future__ import annotations

from ..config import Settings
from ..llm import LLMClient
from ..models import CardCandidate, ModeratedCard

SYSTEM = (
    "You are the Moderator for an adult party card game. For each numbered card "
    "assign a maturity_rating from 0 to 3:\n"
    "  0 = family-friendly, 1 = mild, 2 = raunchy/crude adult humor, "
    "3 = extreme.\n"
    "Also decide 'allowed': false for content that targets protected groups "
    "with hate, sexualizes minors, or is otherwise disallowed. Rate crudeness "
    "with maturity, not by disallowing it.\n"
    'Return ONLY JSON of the form {"verdicts": [{"index": 0, '
    '"maturity_rating": 2, "allowed": true, "reason": "..."}]}.'
)


class Moderator:
    """[CardCandidate] -> [ModeratedCard]"""

    name = "moderator"

    def __init__(self, llm: LLMClient, settings: Settings) -> None:
        self.llm = llm
        self.settings = settings

    def _deny_listed(self, text: str) -> bool:
        low = text.lower()
        return any(term in low for term in self.settings.deny_terms)

    def run(self, candidates: list[CardCandidate]) -> list[ModeratedCard]:
        if not candidates:
            return []
        listing = "\n".join(
            f'{i}. [{c.kind}] {c.text}' for i, c in enumerate(candidates)
        )
        user = f"Cards to moderate:\n{listing}"
        data = self.llm.complete_json(system=SYSTEM, user=user, temperature=0.0)
        raw = data.get("verdicts", data) if isinstance(data, dict) else data

        verdicts: dict[int, dict] = {}
        for entry in raw or []:
            try:
                idx = int(entry.get("index"))
            except (TypeError, ValueError):
                continue
            verdicts[idx] = entry

        moderated: list[ModeratedCard] = []
        for i, card in enumerate(candidates):
            # deny-list is authoritative and independent of the model verdict
            if self._deny_listed(card.text):
                continue
            verdict = verdicts.get(i)
            if verdict is None:
                continue
            if not verdict.get("allowed", False):
                continue
            try:
                rating = int(verdict.get("maturity_rating"))
            except (TypeError, ValueError):
                continue
            if rating < 0 or rating > 3:
                continue
            if rating > self.settings.maturity_max:
                continue  # cap at the target pack ceiling
            try:
                moderated.append(
                    ModeratedCard(
                        kind=card.kind, text=card.text, maturity_rating=rating
                    )
                )
            except Exception:  # noqa: BLE001 - drop anything that fails validation
                continue
        return moderated
