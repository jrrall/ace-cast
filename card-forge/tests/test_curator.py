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
    settings.llm_json_retries = 0
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
    settings.llm_json_retries = 0
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
    llm = FakeLLM([rated_selection(list(range(8))), rated_selection([8])])
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
    settings.llm_json_retries = 0
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


def test_uncertain_joke_survives_unless_quality_cutoff_is_enabled(settings, sample_moderated):
    response = rated_selection([0])
    response["evaluations"][0]["quality"] = {
        "playability": 3, "comic_turn": 1, "specificity": 2,
        "economy": 3, "originality": 2,
    }
    settings.quality_min = 0
    batch = Curator(FakeLLM([response]), FakeContentClient(), settings).run(sample_moderated)
    assert [c.text for c in batch.cards] == [sample_moderated[0].text]
    settings.quality_min = 70
    batch = Curator(FakeLLM([response]), FakeContentClient(), settings).run(sample_moderated)
    assert batch.cards == []


def test_configured_review_cap_can_exceed_old_twenty_card_limit(settings):
    pool = [ModeratedCard(
        kind="prompt" if i % 2 == 0 else "answer",
        text=f"Setup {i}: ____." if i % 2 == 0 else f"Answer {i}.",
        maturity_rating=1,
    ) for i in range(60)]
    for cap in (1, 20, 35, 50):
        settings.batch_max = cap
        size = settings.curator_batch_size
        responses = [rated_selection(list(range(i, min(i + size, len(pool)))))
                     for i in range(0, len(pool), size)]
        batch = Curator(FakeLLM(responses), FakeContentClient(), settings).run(pool)
        assert len(batch.cards) == cap
        assert sum(c.kind == "prompt" for c in batch.cards) == cap // 2


def test_review_defaults_and_api_compatible_cap(monkeypatch):
    import pytest
    from pydantic import ValidationError
    from forge.config import Settings

    monkeypatch.delenv("BATCH_MAX", raising=False)
    monkeypatch.delenv("QUALITY_MIN", raising=False)
    defaults = Settings(_env_file=None)
    assert defaults.batch_max == 50
    assert defaults.quality_min == 70
    monkeypatch.setenv("BATCH_MAX", "12")
    assert Settings(_env_file=None).batch_max == 12
    for value in (0, 51):
        with pytest.raises(ValidationError):
            Settings(_env_file=None, BATCH_MAX=value)


def test_curator_ranks_and_dedupes_globally_across_chunks(settings, sample_moderated):
    settings.curator_batch_size = 1
    responses = [rated_selection([i]) for i in range(3)]
    responses[0]['evaluations'][0]['premise_group'] = 'shared joke'
    responses[2]['evaluations'][0]['premise_group'] = 'shared joke'
    responses[2]['evaluations'][0]['quality'] = dict.fromkeys(
        responses[2]['evaluations'][0]['quality'], 5)
    llm = FakeLLM(responses)
    batch = Curator(llm, FakeContentClient(), settings).run(sample_moderated)
    assert [c.text for c in batch.cards] == [sample_moderated[i].text for i in (2, 1)]
    assert 'shared joke' in llm.calls[2]['user']


def test_curator_rejects_indexes_from_another_chunk(settings, sample_moderated):
    settings.llm_json_retries = 0
    import pytest
    settings.curator_batch_size = 1
    llm = FakeLLM([rated_selection([0]), rated_selection([0])])
    with pytest.raises(ValueError, match='invalid card index'):
        Curator(llm, FakeContentClient(), settings).run(sample_moderated)


def test_positional_scores_without_reason_preserve_weighted_selection(settings, sample_moderated):
    response = {"selected": [0, 1], "evaluations": [
        {"index": 0, "quality": [5, 3, 4, 4, 4], "premise_group": "first"},
        {"index": 1, "quality": [4, 4, 4, 4, 3], "premise_group": "second"},
    ]}
    from forge.rubric import Evaluation
    evaluation = Evaluation.model_validate(response['evaluations'][0])
    assert evaluation.quality.playability == 5
    assert evaluation.quality.comic_turn == 3
    assert evaluation.quality.total(settings.quality_weights) == 81
    assert evaluation.reason is None
    batch = Curator(FakeLLM([response]), FakeContentClient(), settings).run(sample_moderated)
    assert [c.text for c in batch.cards] == [c.text for c in sample_moderated[:2]]


def test_positional_scores_still_require_five_strict_valid_dimensions(settings, sample_moderated):
    settings.llm_json_retries = 0
    import pytest
    for quality in ([4]*4, [4]*6, [True,4,4,4,4], ['4',4,4,4,4],
                    [4.5,4,4,4,4], [-1,4,4,4,4], [6,4,4,4,4], None):
        response = {'selected': [0], 'evaluations': [
            {'index': 0, 'quality': quality, 'premise_group': 'test'},
        ]}
        with pytest.raises(ValueError):
            Curator(FakeLLM([response]), FakeContentClient(), settings).run(sample_moderated)


def test_scalar_quality_triggers_targeted_schema_retry(settings, sample_moderated):
    bad = {'selected': [0], 'evaluations': [
        {'index': 0, 'quality': 14.5, 'premise_group': 'test'},
    ]}
    llm = FakeLLM([bad, rated_selection([0])])
    batch = Curator(llm, FakeContentClient(), settings).run(sample_moderated)
    assert len(batch.cards) == 1
    assert len(llm.calls) == 2
    assert llm.calls[1]['temperature'] == 0
    assert 'Do not infer' in llm.calls[1]['user']
    assert '14.5' in llm.calls[1]['user']


def test_invalid_schema_retry_is_bounded(settings, sample_moderated):
    import pytest
    bad = {'selected': [0], 'evaluations': []}
    llm = FakeLLM([bad, bad])
    with pytest.raises(ValueError, match='omitted'):
        Curator(llm, FakeContentClient(), settings).run(sample_moderated)
    assert len(llm.calls) == 2


def test_missing_group_repair_preserves_scores(settings, sample_moderated):
    settings.llm_json_retries = 0
    bad = rated_selection([0, 1])
    del bad['evaluations'][1]['premise_group']
    llm = FakeLLM([bad, {'groups': [{'index': 1, 'premise_group': 'fixture-0'}]}])
    batch = Curator(llm, FakeContentClient(), settings).run(sample_moderated)
    assert len(llm.calls) == 2
    assert len(batch.cards) == 1  # recovered shared label still drives dedupe
    assert bad['evaluations'][1]['quality']['playability'] == 4
    assert 'premise_group' not in bad['evaluations'][1]  # original response not mutated


def test_missing_group_repair_cannot_invent_missing_scores(settings, sample_moderated):
    import pytest
    settings.llm_json_retries = 0
    bad = rated_selection([0])
    del bad['evaluations'][0]['quality']['playability']
    del bad['evaluations'][0]['premise_group']
    llm = FakeLLM([bad])
    with pytest.raises(ValueError):
        Curator(llm, FakeContentClient(), settings).run(sample_moderated)
    assert len(llm.calls) == 1


def test_complete_chunk_spillover_is_ignored_and_scored_in_own_chunk(settings, sample_moderated, caplog):
    settings.curator_batch_size = 2
    spillover = rated_selection([0, 1, 2])
    spillover['evaluations'][2]['quality'] = dict.fromkeys(
        spillover['evaluations'][2]['quality'], 0)
    llm = FakeLLM([spillover, rated_selection([2])])
    batch = Curator(llm, FakeContentClient(), settings).run(sample_moderated)
    assert len(batch.cards) == 3
    assert len(llm.calls) == 2
    assert spillover['selected'] == [0, 1, 2]  # cached response stays intact
    assert 'curator.out_of_chunk_ignored' in caplog.text


def test_spillover_does_not_hide_invalid_requested_scores(settings, sample_moderated):
    import pytest
    settings.llm_json_retries = 0
    settings.curator_batch_size = 2
    response = rated_selection([0, 1, 2])
    response['evaluations'][0]['quality']['playability'] = 99
    with pytest.raises(ValueError):
        Curator(FakeLLM([response]), FakeContentClient(), settings).run(sample_moderated)


def test_partial_chunk_spillover_still_fails(settings, sample_moderated):
    import pytest
    settings.llm_json_retries = 0
    settings.curator_batch_size = 2
    with pytest.raises(ValueError, match='invalid card index'):
        Curator(FakeLLM([rated_selection([0, 2])]), FakeContentClient(), settings).run(sample_moderated)


def test_curator_separates_prior_context_and_repairs_out_of_range_index(settings, sample_moderated):
    settings.curator_batch_size = 2
    llm = FakeLLM([rated_selection([0, 1]), rated_selection([1]), rated_selection([2])])
    batch = Curator(llm, FakeContentClient(), settings).run(sample_moderated)
    assert len(batch.cards) == 3
    request = llm.calls[1]['user']
    candidates, context = request.split('Prior cards for duplicate context only (not candidates): ')
    assert '2. [' in candidates
    assert '0. [' not in candidates and '1. [' not in candidates
    assert sample_moderated[0].text in context
    assert '"index"' not in context
    retry = llm.calls[2]['user']
    assert 'invalid card index 1; expected 2 through 2' in retry
    assert 'Allowed indexes for selected and evaluations: [2]' in retry
    assert 'quality MUST' not in retry


def test_curator_normalizes_keyed_evaluations_and_known_group_typo_without_retry(settings, sample_moderated):
    from copy import deepcopy
    response = rated_selection([0, 1, 2])
    response['evaluations'][2]['preme_group'] = response['evaluations'][2].pop('premise_group')
    response['evaluations'] = {str(row['index']): row for row in response['evaluations']}
    original = deepcopy(response)
    llm = FakeLLM([response])
    assert len(Curator(llm, FakeContentClient(), settings).run(sample_moderated).cards) == 3
    assert len(llm.calls) == 1
    assert response == original


def test_curator_format_normalization_rejects_conflicts_and_invalid_scores():
    import pytest
    for variant in ('key', 'group', 'score', 'unknown'):
        response = rated_selection([0])
        row = response['evaluations'][0]
        if variant == 'key':
            response['evaluations'] = {'1': row}
        elif variant == 'group':
            row['preme_group'] = 'conflicting_label'
        elif variant == 'score':
            row['quality']['playability'] = 99
        else:
            row['unexpected'] = True
        with pytest.raises(ValueError):
            Curator._validate_response(Curator._normalize_response(response), 0, 1)
