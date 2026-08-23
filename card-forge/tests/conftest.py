"""Shared test fixtures. All network + LLM access is mocked; no real calls."""

from __future__ import annotations

import pytest

from forge.config import Settings
from forge.feeds import FeedItem
from forge.models import CardCandidate, ModeratedCard, Theme


class FakeLLM:
    """Scripted stand-in for ``LLMClient``.

    Return values (already-parsed JSON) are dequeued in call order, so a test
    scripts exactly what each persona's single LLM call yields. Records every
    call for assertions on call count / prompts.
    """

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def complete_json(self, *, system, user, temperature=0.8):
        self.calls.append({"system": system, "user": user, "temperature": temperature})
        if not self._responses:
            raise AssertionError("FakeLLM ran out of scripted responses")
        nxt = self._responses.pop(0)
        return nxt(self.calls[-1]) if callable(nxt) else nxt


class FakeContentClient:
    """Scripted stand-in for ``ContentClient``."""

    def __init__(self, corpus=None, submit_result=None, submit_error=None):
        self._corpus = corpus or []
        self._submit_result = submit_result
        self._submit_error = submit_error
        self.submitted = []
        self.list_calls = 0

    def list_cards(self, *, status=None, kind=None, limit=1000):
        self.list_calls += 1
        return list(self._corpus)

    def submit(self, batch):
        if self._submit_error is not None:
            raise self._submit_error
        self.submitted.append(batch)
        from forge.models import SubmitResult

        if self._submit_result is not None:
            return self._submit_result
        return SubmitResult(created=list(range(len(batch.cards))), skipped=0, rejected=[])


@pytest.fixture
def settings():
    return Settings(
        LLM_API_KEY="test-key",
        CONTENT_API_TOKEN="test-token",
        DENY_LIST="kys,forbiddenword,slur",
        MATURITY_MAX=2,
        THEMES_PER_RUN=4,
        CARDS_PER_THEME=8,
        BATCH_MIN=2,
        BATCH_MAX=20,
    )


@pytest.fixture
def sample_feed_items():
    return [
        FeedItem(title="Everyone is quitting their job to become a goblin", source="r/memes"),
        FeedItem(title="AI wrote my resignation letter", source="r/memes"),
    ]


@pytest.fixture
def sample_theme():
    return Theme(title="Millennial burnout", angle="Work is a scam", source="r/memes")


@pytest.fixture
def sample_candidates():
    return [
        CardCandidate(kind="prompt", text="My therapist quit after I mentioned ____."),
        CardCandidate(kind="answer", text="A haunted Roomba."),
        CardCandidate(kind="answer", text="Crippling student debt."),
    ]


@pytest.fixture
def sample_moderated():
    return [
        ModeratedCard(
            kind="prompt",
            text="My therapist quit after I mentioned ____.",
            maturity_rating=2,
        ),
        ModeratedCard(kind="answer", text="A haunted Roomba.", maturity_rating=1),
        ModeratedCard(kind="answer", text="Crippling student debt.", maturity_rating=1),
    ]
