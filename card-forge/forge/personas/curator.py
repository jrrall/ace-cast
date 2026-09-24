"""Persona 5 — Curator.

Fetches the existing corpus (ALL statuses incl. denied) via the content API,
drops near-duplicates against it and within the batch, then makes ONE LLM call
to rank/select up to the configured maximum into a ``SubmitBatch``.

Agent dedupe (fuzzy, normalised text) and server dedupe (exact ``(pack_id,text)``)
are complementary: the agent trims obvious dups pre-flight; the server is the
authoritative guard. Both include denied text so denied cards never re-flood
the review queue.
"""

from __future__ import annotations

from ..balance import type_budget
from ..client import ContentClient
from ..config import Settings
from ..llm import LLMClient
from ..models import ModeratedCard, SubmitBatch, SubmitCard
from ..text import normalize_text
from ..prompts import maturity_direction, HUMOR_DIRECTION
from ..rubric import RUBRIC, Evaluation
from ..logging_setup import get_logger

SYSTEM = (
    "You are the Curator for an adult party card game. From a numbered list of "
    "vetted cards, select the funniest, most varied set for human review. Prefer a "
    "mix of prompts and answers and avoid repetitive jokes.\n"
    + HUMOR_DIRECTION + RUBRIC
    + "Reward specific surprises and playable combinations. Reject generic "
    "burnout filler and slang-only jokes. Prefer a varied mix of dry deadpan "
    "understatement, coherent unhinged escalation, dishonest PR optimism, and "
    "petty personal spite, and crude forum shock humor when they are "
    "strong; do not fill a "
    "style quota with weak cards. Reward Hatemonger's self-incriminating paranoia "
    "when its disproportion creates a playable joke. A blunt filthy image or appalling confession "
    "can earn a comic turn without an elaborate setup. Do not penalize "
    "vulgarity, blasphemy, or grossness just for being abrasive.\n"
    "Compare SITUATIONS and COMIC MECHANISMS, not just wording. Keep at most one "
    "card from a repeated setup: variations on the same video being ruined by "
    "the same technology are duplicates even if one mentions a genre and another "
    "a weapon. Shared research does not justify repeated punchlines. "
    "Reject headline Mad Libs and random-object whimsy with no comic consequence. "
    "Look for a playable turn that earns a laugh and then an uncomfortable "
    "realization. A short strong batch beats a full batch of mild variations. "
    "There is no minimum batch size; returning zero is valid.\n"
    'Return ONLY JSON with "selected" (ranked zero-based indexes) and '
    '"evaluations" (one per selected index). Each evaluation contains index, '
    'quality: {playability, comic_turn, specificity, economy, originality}, '
    'premise_group (a short label), and reason (at most 12 words). '
    'Omit style scores and card text from the response. '
    'All dimension scores are integers 0-5. Assign the SAME premise_group to '
    'variations on the same situation and joke mechanism. Do not use unique '
    'labels to disguise repetition. Select fewer or none if weak. '
    'Use {"selected": [], "evaluations": []} when nothing deserves review.'
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
        budget = type_budget(self.settings.batch_max)
        user = (
            f"Vetted cards:\n{listing}\n\n"
            f"Valid indexes are the integers 0 through {len(pool) - 1}, inclusive. "
            "Rank and evaluate all cards worth human review. "
            f"There are separate slots for up to {budget['prompt']} prompts and "
            f"{budget['answer']} answers; do not substitute one kind for the other. "
            f"Quality floor is {self.settings.quality_min}/100, using weights "
            f"{self.settings.quality_weights}. Return selected indexes plus evaluations as specified."
        )
        data = self.llm.complete_json(system=SYSTEM + maturity_direction(self.settings.maturity_max), user=user, temperature=0.3)
        raw = data.get("selected", data) if isinstance(data, dict) else data

        if not isinstance(raw, list):
            raise ValueError("curator selected must be a list of card indexes")
        order: list[int] = []
        for idx in raw:
            if type(idx) is not int or not 0 <= idx < len(pool):
                raise ValueError("curator returned an invalid card index")
            if idx not in order:
                order.append(idx)

        raw_evaluations = data.get("evaluations") if isinstance(data, dict) else None
        if not isinstance(raw_evaluations, list):
            raise ValueError("curator evaluations must be a list")
        evaluations = {}
        for raw_evaluation in raw_evaluations:
            evaluation = Evaluation.model_validate(raw_evaluation)
            if evaluation.index >= len(pool) or evaluation.index in evaluations:
                raise ValueError("curator returned duplicate or invalid evaluation index")
            if not evaluation.premise_group.strip():
                raise ValueError("curator premise_group cannot be blank")
            evaluations[evaluation.index] = evaluation
        if any(idx not in evaluations for idx in order):
            raise ValueError("curator omitted a selected card evaluation")
        ranked = sorted(order, key=lambda idx: evaluations[idx].quality.total(self.settings.quality_weights), reverse=True)
        chosen = []
        groups = set()
        for idx in ranked:
            evaluation = evaluations[idx]
            score = evaluation.quality.total(self.settings.quality_weights)
            group = evaluation.premise_group.strip().casefold()
            keep = (score >= self.settings.quality_min
                    and evaluation.quality.playability >= 3
                    and evaluation.quality.comic_turn >= 3
                    and group not in groups
                    and budget[pool[idx].kind] > 0)
            get_logger().info("curator.score", extra={"extra_fields": {
                "index": idx, "text": pool[idx].text, "score": score, "kept": keep,
                **evaluation.model_dump(exclude={"index"}, exclude_none=True),
            }})
            if keep:
                budget[pool[idx].kind] -= 1
                groups.add(group)
                chosen.append(pool[idx])
        cards = [SubmitCard.from_moderated(c, pack) for c in chosen]
        return SubmitBatch(cards=cards, pack=pack)
