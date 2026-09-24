"""Persona 4 — Moderator.

One LLM call to assign a maturity rating (0-3) and a policy verdict per card.
Then a deterministic, defence-in-depth pass:
  * drop cards the model flagged as out-of-policy,
  * drop cards whose maturity exceeds the generator's configured ``maturity_max`` (cap),
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
    "3 = extreme adult humor with strongly disturbing, filthy, grotesque, or "
    "taboo comic implications. Rate what the card actually says or clearly "
    "implies; do not inflate ratings to match a generation target, and do not "
    "downgrade extreme content merely because it uses euphemism.\n"
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
        duplicates: set[int] = set()
        for entry in raw if isinstance(raw, list) else []:
            if not isinstance(entry, dict):
                continue
            idx = entry.get("index")
            if type(idx) is not int or not 0 <= idx < len(candidates):
                continue
            if idx in verdicts:
                duplicates.add(idx)
            verdicts[idx] = entry

        moderated: list[ModeratedCard] = []
        for i, card in enumerate(candidates):
            # deny-list is authoritative and independent of the model verdict
            if self._deny_listed(card.text):
                continue
            verdict = verdicts.get(i)
            if verdict is None or i in duplicates:
                continue
            if verdict.get("allowed") is not True:
                continue
            rating = verdict.get("maturity_rating")
            if type(rating) is not int:
                continue
            if rating < 0 or rating > 3:
                continue
            if rating > self.settings.maturity_max:
                continue  # cap at the configured generator ceiling
            try:
                moderated.append(
                    ModeratedCard(
                        kind=card.kind, text=card.text, maturity_rating=rating, writer=card.writer
                    )
                )
            except Exception:  # noqa: BLE001 - drop anything that fails validation
                continue
        return moderated
