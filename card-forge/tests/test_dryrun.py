"""End-to-end dry-run: assembled batch is all-valid and nothing is submitted.

Also asserts observability: 5 distinct persona stage log entries and a POST
that never happens in dry-run.
"""

from __future__ import annotations

import json
import logging

from forge.models import BLANK_MARKER
from forge.pipeline import Pipeline

from conftest import FakeContentClient, FakeLLM


def _scripted_llm():
    # exactly one theme -> Writer called once -> 5 LLM calls total
    return FakeLLM(
        [
            {"themes": [{"title": "Burnout", "angle": "work is a scam"}]},
            {
                "cards": [
                    {"kind": "prompt", "text": "My new hustle is just ____."},
                    {"kind": "answer", "text": "A raccoon in a trench coat."},
                    {"kind": "answer", "text": "Existential dread."},
                ]
            },
            {
                "cards": [
                    {"kind": "prompt", "text": "My new hustle is just ____."},
                    {"kind": "answer", "text": "A raccoon in a trench coat."},
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
            {"selected": [0, 1, 2]},
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


def test_dry_run_five_distinct_persona_calls(settings, caplog):
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
    assert personas == ["trendscout", "writer", "editor", "moderator", "curator"]
    # 5 distinct underlying LLM calls
    assert len(llm.calls) == 5


def _feed():
    from forge.feeds import FeedItem

    return [FeedItem(title="Everyone became a freelance goblin", source="r/memes")]
