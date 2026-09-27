"""Validation invariants on the stage-boundary models."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from forge.models import CardCandidate, ModeratedCard, SubmitCard


@pytest.mark.parametrize("text", ["My alibi\u2014____.", "My alibi \u2014 ____."])
def test_em_dash_removed_through_submission(text):
    candidate = CardCandidate(kind="prompt", text=text)
    assert candidate.text == "My alibi, ____."
    moderated = ModeratedCard(**candidate.model_dump(), maturity_rating=2)
    submitted = SubmitCard.from_moderated(moderated, "madlad-generated")
    assert submitted.text == candidate.text
    assert submitted.blanks == 1


def test_direct_submission_also_cleans_em_dash():
    card = SubmitCard(kind="answer", text="Apologies\u2014with ads.",
                      blanks=0, maturity_rating=2, pack="madlad-generated")
    assert card.text == "Apologies, with ads"


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


@pytest.mark.parametrize(("raw", "expected"), [
    ("a gloriously delayed tradition", "A gloriously delayed tradition"),
    ("swallows his own dry rattle.", "Swallows his own dry rattle"),
    ("  a NASA\n press release  ", "A NASA press release"),
    ('“a NASA apology”', '“A NASA apology”'),
    ('“why?”', '“Why?”'),
    ("panic!", "Panic!"),
    ("waiting…", "Waiting…"),
    ("(a delayed tradition)", "(A delayed tradition)"),
])
def test_final_output_finishes_text_without_rewriting_drafts(raw, expected):
    from forge.models import SubmitBatch

    draft = ModeratedCard(kind="answer", text=raw, maturity_rating=2,
                          writer="deadpan", generation_route="writer")
    original = draft.model_dump()
    submitted = SubmitCard.from_moderated(draft, "p")
    batch = SubmitBatch(cards=[submitted], pack="p")
    assert batch.payload()["cards"][0]["text"] == expected
    assert submitted.writer == draft.writer
    assert submitted.generation_route == draft.generation_route
    assert draft.model_dump() == original
    assert SubmitCard.model_validate(submitted.model_dump()).text == expected


@pytest.mark.parametrize(("raw", "expected"), [
    ("my alibi is ____", "My alibi is ____."),
    ("____ is my alibi", "____ is my alibi."),
    ("why ____?", "Why ____?"),
    ("tonight's special: ____", "Tonight's special: ____."),
    ("____: choose wisely:", "____: choose wisely:"),
])
def test_final_prompt_preserves_blanks_and_punctuation(raw, expected):
    submitted = SubmitCard(kind="prompt", text=raw, blanks=1,
                           maturity_rating=1, pack="p")
    assert submitted.text == expected
    assert submitted.blanks == 1


def test_answer_length_check_matches_final_cleanup():
    from forge.limits import ANSWER_MAX_CHARS, too_long

    card = ModeratedCard(kind="answer", text="a" * ANSWER_MAX_CHARS + ".",
                         maturity_rating=1)
    assert not too_long(card)
    assert len(SubmitCard.from_moderated(card, "p").text) == ANSWER_MAX_CHARS
