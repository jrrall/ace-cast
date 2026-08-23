"""Curator in isolation: moderated cards + mocked GET + mocked LLM -> SubmitBatch.

Covers dedupe against the fetched corpus (including a DENIED card) and the
final ranked selection.
"""

from __future__ import annotations

from forge.models import ModeratedCard, SubmitBatch
from forge.personas import Curator

from conftest import FakeContentClient, FakeLLM


def test_curator_assembles_batch(settings, sample_moderated):
    content = FakeContentClient(corpus=[])
    llm = FakeLLM([{"selected": [2, 0, 1]}])
    batch = Curator(llm, content, settings).run(sample_moderated)

    assert isinstance(batch, SubmitBatch)
    assert len(batch.cards) == 3
    assert batch.cards[0].text == "Crippling student debt."  # selection order honored
    assert all(c.pack == settings.pack_slug for c in batch.cards)


def test_curator_drops_duplicate_including_denied(settings):
    moderated = [
        ModeratedCard(kind="answer", text="A haunted Roomba.", maturity_rating=1),
        ModeratedCard(kind="answer", text="A fresh original card.", maturity_rating=1),
    ]
    # corpus contains the first card as a DENIED row -> must still be treated as dup
    content = FakeContentClient(
        corpus=[
            {"text": "A haunted Roomba.", "status": "denied"},
        ]
    )
    llm = FakeLLM([{"selected": [0]}])
    batch = Curator(llm, content, settings).run(moderated)

    texts = [c.text for c in batch.cards]
    assert "A haunted Roomba." not in texts
    assert "A fresh original card." in texts
    assert content.list_calls == 1


def test_curator_normalizes_before_dedupe(settings):
    moderated = [
        ModeratedCard(kind="answer", text="Crippling Student Debt!!!", maturity_rating=1),
    ]
    content = FakeContentClient(corpus=[{"text": "crippling student debt", "status": "approved"}])
    llm = FakeLLM([{"selected": [0]}])
    batch = Curator(llm, content, settings).run(moderated)
    assert batch.cards == []  # normalised match -> deduped away
