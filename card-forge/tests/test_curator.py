"""Curator in isolation: moderated cards + mocked GET + mocked LLM -> SubmitBatch.

Covers dedupe against the fetched corpus (including a DENIED card) and the
final ranked selection.
"""

from __future__ import annotations

from forge.models import ModeratedCard, SubmitBatch
from forge.personas import Curator

from conftest import rated_selection, FakeContentClient, FakeLLM


def test_curator_assembles_batch(settings, sample_moderated):
    content = FakeContentClient(corpus=[])
    llm = FakeLLM([rated_selection([2, 0, 1])])
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
    llm = FakeLLM([rated_selection([0])])
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
    llm = FakeLLM([rated_selection([0])])
    batch = Curator(llm, content, settings).run(moderated)
    assert batch.cards == []  # normalised match -> deduped away


def test_empty_selection_does_not_publish_entire_pool(settings, sample_moderated):
    batch = Curator(FakeLLM([rated_selection([])]), FakeContentClient(), settings).run(sample_moderated)
    assert batch.cards == []


def test_invalid_ranking_fails_closed(settings, sample_moderated):
    import pytest
    for selected in [[True], [0.9], ["0"], [999], "invalid"]:
        with pytest.raises(ValueError):
            Curator(FakeLLM([{"selected": selected}]), FakeContentClient(), settings).run(sample_moderated)


def test_scoring_gates_quality_independently_of_style(settings, sample_moderated):
    response = rated_selection([0, 1, 2])
    response['evaluations'][0]['quality']['playability'] = 0
    response['evaluations'][0]['style'] = dict.fromkeys(response['evaluations'][0]['style'], 5)
    response['evaluations'][1]['quality'] = dict.fromkeys(response['evaluations'][1]['quality'], 5)
    response['evaluations'][2]['quality'] = dict.fromkeys(response['evaluations'][2]['quality'], 2)
    batch = Curator(FakeLLM([response]), FakeContentClient(), settings).run(sample_moderated)
    assert [c.text for c in batch.cards] == [sample_moderated[1].text]


def test_same_premise_keeps_strongest_even_when_ranked_later(settings, sample_moderated):
    response = rated_selection([0, 1])
    response['evaluations'][0]['premise_group'] = 'Viking music video'
    response['evaluations'][1]['premise_group'] = ' viking music video '
    response['evaluations'][1]['quality'] = dict.fromkeys(response['evaluations'][1]['quality'], 5)
    batch = Curator(FakeLLM([response]), FakeContentClient(), settings).run(sample_moderated)
    assert [c.text for c in batch.cards] == [sample_moderated[1].text]


def test_missing_or_invalid_scores_fail_closed(settings, sample_moderated):
    import pytest
    responses = [dict(selected=[0], evaluations=[])]
    for score in [True, 6, -1, '4', 2.5]:
        response = rated_selection([0])
        response['evaluations'][0]['quality']['comic_turn'] = score
        responses.append(response)
    for response in responses:
        with pytest.raises(ValueError):
            Curator(FakeLLM([response]), FakeContentClient(), settings).run(sample_moderated)

def test_prompt_first_ranking_reserves_answer_slots(settings):
    settings.batch_max = 5
    pool = [
        *[ModeratedCard(kind="prompt", text=f"Setup {i}: ____.", maturity_rating=1)
          for i in range(5)],
        *[ModeratedCard(kind="answer", text=f"Answer {i}.", maturity_rating=1)
          for i in range(4)],
    ]
    llm = FakeLLM([rated_selection(list(range(9)))])
    batch = Curator(llm, FakeContentClient(), settings).run(pool)
    assert [c.text for c in batch.cards] == [pool[i].text for i in [0, 1, 5, 6, 7]]


def test_type_shortfall_does_not_restore_unselected_cards(settings, sample_moderated):
    settings.batch_max = 2
    llm = FakeLLM([rated_selection([1, 2])])
    batch = Curator(llm, FakeContentClient(), settings).run(sample_moderated)
    assert [c.text for c in batch.cards] == [sample_moderated[1].text]


def test_misspelled_diagnostic_does_not_lose_valid_batch(settings, sample_moderated, caplog):
    response = rated_selection([0, 1, 2])
    style = response["evaluations"][0]["style"]
    style["dead,pan"] = style.pop("deadpan")
    del response["evaluations"][1]["style"]
    batch = Curator(FakeLLM([response]), FakeContentClient(), settings).run(sample_moderated)
    assert len(batch.cards) == 3
    assert "curator.invalid_style_ignored" in caplog.text


def test_missing_quality_still_fails_with_bad_style(settings, sample_moderated):
    import pytest
    response = rated_selection([0])
    response["evaluations"][0]["style"] = {"dead,pan": 5}
    del response["evaluations"][0]["quality"]["playability"]
    with pytest.raises(ValueError):
        Curator(FakeLLM([response]), FakeContentClient(), settings).run(sample_moderated)


def test_compact_response_preserves_selection(settings, sample_moderated):
    response = rated_selection([2, 0, 1])
    for evaluation in response["evaluations"]:
        del evaluation["style"]
    batch = Curator(FakeLLM([response]), FakeContentClient(), settings).run(sample_moderated)
    assert [c.text for c in batch.cards] == [sample_moderated[i].text for i in [2, 0, 1]]
