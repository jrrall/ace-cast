"""End-to-end dry-run: assembled batch is all-valid and nothing is submitted.

Also asserts observability: 13 distinct persona stage log entries and a POST
that never happens in dry-run.
"""

from __future__ import annotations

import json
import logging

from forge.models import BLANK_MARKER
from forge.limits import ANSWER_MAX_WORDS
from forge.pipeline import Pipeline

from conftest import rated_selection, FakeContentClient, FakeLLM


def _scripted_llm():
    # exactly one theme -> all nine writers called once -> 13 LLM calls total
    return FakeLLM(
        [
            {"themes": [{"title": "Burnout", "angle": "work is a scam"}]},
            {
                "cards": [
                    {"kind": "prompt", "text": "My new hustle is just ____."},
                    {"kind": "answer", "text": "Trench-coat raccoons."},
                ]
            },
            {"cards": [{"kind": "answer", "text": "Existential dread."}]},  # unhinged writer
            {"cards": []},  # PR Spin Doctor
            {"cards": []},  # Petty Villain
            {"cards": []},  # Banned From 4chan
            {"cards": []},  # Hatemonger
            {"cards": []},  # Toxic Positivity
            {"cards": []},  # Intrusive Thoughts
            {"cards": []},  # Super Bitch
            {
                "cards": [
                    {"kind": "prompt", "text": "My new hustle is just ____."},
                    {"kind": "answer", "text": "Trench-coat raccoons."},
                    {"kind": "answer", "text": "Existential dread."},
                ]
            },
            {
                "verdicts": [
                    {"index": 0, "maturity_rating": 2, "allowed": True},
                    {"index": 1, "maturity_rating": 1, "allowed": True},
                    {"index": 2, "maturity_rating": 1, "allowed": True},
                ]
            },
            rated_selection([0, 1, 2]),
        ]
    )


def test_dry_run_batch_all_valid(settings):
    llm = _scripted_llm()
    content = FakeContentClient(corpus=[])
    pipeline = Pipeline(settings, llm, content, fetch_fn=lambda s: _feed())
    summary, batch = pipeline.run(dry_run=True)

    assert len(batch.cards) == 3
    for c in batch.cards:
        assert c.kind in {"prompt", "answer"}
        assert c.maturity_rating <= settings.maturity_max
        if c.kind == "prompt":
            assert BLANK_MARKER in c.text
            assert c.blanks == c.text.count(BLANK_MARKER)
        else:
            assert BLANK_MARKER not in c.text
            assert c.blanks == 0

    # dry-run submits nothing
    assert content.submitted == []
    # payload is serialisable
    json.dumps(batch.payload())


def test_dry_run_thirteen_distinct_persona_calls(settings, caplog):
    llm = _scripted_llm()
    content = FakeContentClient(corpus=[])
    pipeline = Pipeline(settings, llm, content, fetch_fn=lambda s: _feed())

    with caplog.at_level(logging.INFO, logger="forge"):
        pipeline.run(dry_run=True)

    personas = [
        r.__dict__["extra_fields"]["persona"]
        for r in caplog.records
        if isinstance(getattr(r, "extra_fields", None), dict)
        and r.extra_fields.get("stage")
    ]
    assert personas == ["trendscout", "writer.deadpan", "writer.unhinged", "writer.pr_spin_doctor", "writer.petty_villain", "writer.banned_from_4chan", "writer.hatemonger", "writer.toxic_positivity", "writer.intrusive_thoughts", "writer.super_bitch", "editor", "moderator", "curator"]
    # 13 distinct underlying LLM calls
    assert len(llm.calls) == 13


def _feed():
    from forge.feeds import FeedItem

    return [FeedItem(title="Everyone became a freelance goblin", source="r/memes")]


def test_prompt_over_54_characters_survives_pipeline_without_shortening(settings):
    llm = _scripted_llm()
    text = "The court ruled we're slaves because ____ won't toggle a feature."
    llm._responses[1]['cards'][0]['text'] = text
    llm._responses[10]['cards'][0] = {'source_index': 0, 'kind': 'prompt', 'text': text}
    pipeline = Pipeline(settings, llm, FakeContentClient(), fetch_fn=lambda s: _feed())
    _, batch = pipeline.run(dry_run=True)
    assert next(c for c in batch.cards if c.kind == 'prompt').text == text
    assert len(llm.calls) == 13


def test_answer_shortens_before_editing_and_after_editor_expansion(settings):
    llm = _scripted_llm()
    long = 'the ' + ' '.join(['cat'] * (ANSWER_MAX_WORDS + 1))
    llm._responses[1]['cards'][1]['text'] = long
    llm._responses[10]['cards'][1] = {'source_index': 1, 'kind': 'answer', 'text': long}
    rewrite = {'cards': [{'index': 1, 'kind': 'answer', 'text': 'Trench-coat raccoons.'}]}
    llm._responses.insert(10, rewrite)
    llm._responses.insert(12, rewrite)
    pipeline = Pipeline(settings, llm, FakeContentClient(), fetch_fn=lambda s: _feed())
    _, batch = pipeline.run(dry_run=True)
    assert batch.cards[1].text == 'Trench-coat raccoons.'
    assert batch.cards[1].writer == 'writer.deadpan'
    for index in (10, 12):
        assert f'{ANSWER_MAX_WORDS} non-filler words' in llm.calls[index]['system']
        assert f'"current_words": {ANSWER_MAX_WORDS + 1}' in llm.calls[index]['user']
    assert 'Trench-coat raccoons.' in llm.calls[11]['user']
