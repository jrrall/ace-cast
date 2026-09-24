"""Moderator in isolation: candidates + mocked LLM -> ModeratedCards.

Covers maturity cap, out-of-policy drop, and the deny-list defence that is
independent of the model verdict.
"""

from __future__ import annotations

from forge.models import CardCandidate, ModeratedCard
from forge.personas import Moderator

from conftest import FakeLLM


def test_moderator_assigns_ratings_and_caps(settings, sample_candidates):
    llm = FakeLLM(
        [
            {
                "verdicts": [
                    {"index": 0, "maturity_rating": 2, "allowed": True},
                    {"index": 1, "maturity_rating": 1, "allowed": True},
                    {"index": 2, "maturity_rating": 3, "allowed": True},  # over cap 2
                ]
            }
        ]
    )
    out = Moderator(llm, settings).run(sample_candidates)
    assert all(isinstance(c, ModeratedCard) for c in out)
    assert len(out) == 2  # the maturity-3 card is dropped by the cap
    assert {c.maturity_rating for c in out} <= {0, 1, 2}


def test_moderator_drops_disallowed(settings, sample_candidates):
    llm = FakeLLM(
        [
            {
                "verdicts": [
                    {"index": 0, "maturity_rating": 2, "allowed": False, "reason": "hate"},
                    {"index": 1, "maturity_rating": 1, "allowed": True},
                    {"index": 2, "maturity_rating": 1, "allowed": True},
                ]
            }
        ]
    )
    out = Moderator(llm, settings).run(sample_candidates)
    assert len(out) == 2
    assert all("therapist" not in c.text for c in out)


def test_moderator_deny_list_overrides_model(settings):
    # even if the model says a deny-listed card is allowed + low maturity, drop it
    cards = [
        CardCandidate(kind="answer", text="A perfectly nice answer."),
        CardCandidate(kind="answer", text="Contains forbiddenword inside."),
    ]
    llm = FakeLLM(
        [
            {
                "verdicts": [
                    {"index": 0, "maturity_rating": 1, "allowed": True},
                    {"index": 1, "maturity_rating": 0, "allowed": True},
                ]
            }
        ]
    )
    out = Moderator(llm, settings).run(cards)
    assert len(out) == 1
    assert out[0].text == "A perfectly nice answer."


def test_malformed_verdicts_cannot_approve(settings, sample_candidates):
    for bad in [
        {'index': 0, 'maturity_rating': 1, 'allowed': 'false'},
        {'index': 0, 'maturity_rating': 1, 'allowed': 1},
        {'index': False, 'maturity_rating': 1, 'allowed': True},
        {'index': 0, 'maturity_rating': 1.9, 'allowed': True},
        {'index': 0, 'maturity_rating': True, 'allowed': True},
        None, 'garbage',
    ]:
        llm = FakeLLM([{'verdicts': [bad]}])
        assert Moderator(llm, settings).run(sample_candidates) == []


def test_conflicting_duplicate_verdicts_are_dropped(settings, sample_candidates):
    llm = FakeLLM([{'verdicts': [
        {'index': 0, 'maturity_rating': 1, 'allowed': False},
        {'index': 0, 'maturity_rating': 1, 'allowed': True},
    ]}])
    assert Moderator(llm, settings).run(sample_candidates) == []


def test_extreme_rating_survives_when_enabled_without_inflating_other_ratings(settings, sample_candidates):
    settings.maturity_max = 3
    llm = FakeLLM([{"verdicts": [
        {"index": 0, "maturity_rating": 3, "allowed": True},
        {"index": 1, "maturity_rating": 1, "allowed": True},
        {"index": 2, "maturity_rating": 3, "allowed": False},
    ]}])
    cards = Moderator(llm, settings).run(sample_candidates)
    assert [c.maturity_rating for c in cards] == [3, 1]
