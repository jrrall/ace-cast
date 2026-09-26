"""Persona 4 — Moderator.

Bounded sequential LLM calls assign a maturity rating (0-3) and a policy verdict per card.
Then a deterministic, defence-in-depth pass:
  * drop cards the model flagged as out-of-policy,
  * drop cards whose maturity exceeds the generator's configured ``maturity_max`` (cap),
  * drop cards containing any configured deny-list term (independent of the LLM,
    so a prompt-injected model that emits banned content is still caught).
"""

from __future__ import annotations

from ..call_context import complete

from ..config import Settings
from ..llm import LLMClient
from ..logging_setup import get_logger
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
    '"maturity_rating": 2, "allowed": true}]}. '
    'Return exactly one verdict per supplied index; never omit a card. '
    'Omit explanations for allowed cards. For rejected cards only, include a '
    'reason of at most eight words.'
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
        moderated: list[ModeratedCard] = []
        size = self.settings.moderator_batch_size
        for start in range(0, len(candidates), size):
            chunk = candidates[start:start + size]
            get_logger().info("moderator.batch_started", extra={"extra_fields": {
                "offset": start, "cards": len(chunk), "total": len(candidates),
            }})
            moderated.extend(self._moderate_batch(chunk, offset=start))
            get_logger().info("moderator.batch_completed", extra={"extra_fields": {
                "offset": start, "moderated_so_far": len(moderated),
            }})
        return moderated

    def _moderate_batch(self, candidates: list[CardCandidate], *, offset=0) -> list[ModeratedCard]:
        listing = "\n".join(
            f'{i}. [{c.kind}] {c.text}' for i, c in enumerate(candidates)
        )
        user = f"Cards to moderate:\n{listing}"
        verdicts: dict[int, dict] = {}
        pending = {i for i, card in enumerate(candidates) if not self._deny_listed(card.text)}
        for attempt in range(self.settings.llm_json_retries + 1):
            if not pending:
                break
            request = user if attempt == 0 else (
                f"Repair attempt {attempt}: return exactly one valid verdict for each index "
                f"in {sorted(pending)}. Preserve these indexes; do not renumber. "
                "allowed must be a boolean and maturity_rating an integer from 0 to 3.\n"
                "Cards to moderate:\n" + "\n".join(
                    f'{i}. [{candidates[i].kind}] {candidates[i].text}' for i in sorted(pending))
            )
            data = complete(self.llm, "moderator", units=len(pending), batch=offset,
                            system=SYSTEM, user=request, temperature=0.0)
            raw = data.get("verdicts", data) if isinstance(data, dict) else data
            received, duplicates = {}, set()
            for entry in raw if isinstance(raw, list) else []:
                if not isinstance(entry, dict):
                    continue
                idx = entry.get("index")
                if type(idx) is not int or idx not in pending:
                    continue
                if idx in received:
                    duplicates.add(idx)
                received[idx] = entry
            for idx, entry in received.items():
                rating = entry.get("maturity_rating")
                if (idx not in duplicates and type(entry.get("allowed")) is bool
                        and type(rating) is int and 0 <= rating <= 3):
                    verdicts[idx] = entry
                    pending.remove(idx)
            if pending:
                get_logger().warning("moderator.incomplete_verdicts", extra={"extra_fields": {
                    "offset": offset, "attempt": attempt + 1, "indexes": sorted(pending),
                }})
        if pending:
            raise ValueError(f"Moderator batch {offset} missing valid verdicts for indexes {sorted(pending)}")

        moderated: list[ModeratedCard] = []
        for i, card in enumerate(candidates):
            # deny-list is authoritative and independent of the model verdict
            if self._deny_listed(card.text):
                continue
            verdict = verdicts.get(i)
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
                        kind=card.kind, text=card.text, maturity_rating=rating, writer=card.writer,
                        generation_route=card.generation_route, source_url=card.source_url
                    )
                )
            except Exception:  # noqa: BLE001 - drop anything that fails validation
                continue
        return moderated
