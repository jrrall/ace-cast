"""Deterministic type budgets; an odd slot goes to answers."""

from collections import Counter

from .models import CardCandidate


def type_budget(total: int) -> dict[str, int]:
    return {"prompt": total // 2, "answer": total - total // 2}


def balanced_cards[T: CardCandidate](cards: list[T], total: int, *, prompts: int | None = None) -> list[T]:
    """Keep ranked order within each budget; never backfill missing types."""
    remaining = type_budget(total) if prompts is None else {"prompt": prompts, "answer": total - prompts}
    chosen = []
    for card in cards:
        if remaining[card.kind] > 0:
            chosen.append(card)
            remaining[card.kind] -= 1
    return chosen


def type_counts(cards: list) -> dict[str, int]:
    counts = Counter(card.kind for card in cards)
    return {"prompts": counts["prompt"], "answers": counts["answer"]}
