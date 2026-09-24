"""Validation invariants on the stage-boundary models."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from forge.models import CardCandidate, ModeratedCard, SubmitCard


def test_prompt_without_marker_rejected():
    with pytest.raises(ValidationError):
        CardCandidate(kind="prompt", text="no blank here")


def test_answer_with_marker_rejected():
    with pytest.raises(ValidationError):
        CardCandidate(kind="answer", text="answers cannot have ____")


def test_prompt_blanks_coerced_to_marker_count():
    c = CardCandidate(kind="prompt", text="____ and ____", blanks=99)
    assert c.blanks == 2


def test_bad_kind_rejected():
    with pytest.raises(ValidationError):
        CardCandidate(kind="wildcard", text="whatever")


def test_moderated_maturity_range_enforced():
    with pytest.raises(ValidationError):
        ModeratedCard(kind="answer", text="fine", maturity_rating=5)


def test_submit_card_blanks_mismatch_rejected():
    with pytest.raises(ValidationError):
        SubmitCard(
            kind="prompt", text="one blank ____", blanks=2, maturity_rating=1, pack="p"
        )


def test_submit_card_from_moderated_roundtrip():
    m = ModeratedCard(kind="prompt", text="best is ____.", maturity_rating=2)
    s = SubmitCard.from_moderated(m, "madlad-generated")
    assert s.pack == "madlad-generated"
    assert s.blanks == 1
    assert s.maturity_rating == 2
