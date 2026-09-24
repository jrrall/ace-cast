"""Fail-closed behaviour: any stage error -> non-zero exit, nothing submitted."""

from __future__ import annotations

import pytest

from forge import cli
from forge.client import ContentAPIError
from forge.feeds import FeedError
from forge.llm import LLMError
from forge.pipeline import Pipeline

from conftest import FakeContentClient, FakeLLM


def _feed(_settings=None):
    from forge.feeds import FeedItem

    return [FeedItem(title="anything", source="r/memes")]


def test_feed_error_aborts_before_submit(settings):
    def boom(_s):
        raise FeedError("source unreachable")

    llm = FakeLLM([])
    content = FakeContentClient(corpus=[])
    pipeline = Pipeline(settings, llm, content, fetch_fn=boom)

    with pytest.raises(FeedError):
        pipeline.run(dry_run=False)
    assert content.submitted == []


def test_llm_error_aborts_before_submit(settings):
    class ExplodingLLM:
        calls = []

        def complete_json(self, *, system, user, temperature=0.8):
            raise LLMError("gateway down")

    content = FakeContentClient(corpus=[])
    pipeline = Pipeline(settings, ExplodingLLM(), content, fetch_fn=_feed)

    with pytest.raises(LLMError):
        pipeline.run(dry_run=False)
    assert content.submitted == []


def test_api_error_on_submit_surfaces_and_nothing_persists(settings):
    llm = FakeLLM(
        [
            {"themes": [{"title": "T", "angle": "a"}]},
            {"cards": [{"kind": "answer", "text": "Tax fraud."}]},
            {"cards": [{"kind": "answer", "text": "Tax fraud."}]},
            {"verdicts": [{"index": 0, "maturity_rating": 1, "allowed": True}]},
            {"selected": [0]},
        ]
    )
    content = FakeContentClient(
        corpus=[], submit_error=ContentAPIError("POST failed 500")
    )
    pipeline = Pipeline(settings, llm, content, fetch_fn=_feed)

    with pytest.raises(ContentAPIError):
        pipeline.run(dry_run=False)
    assert content.submitted == []


def test_cli_returns_nonzero_on_stage_failure(settings, monkeypatch):
    class FailingPipeline:
        def __init__(self, *a, **k):
            pass

        def run(self, *, dry_run=False):
            raise LLMError("boom")

    monkeypatch.setattr(cli, "load_settings", lambda **k: settings)
    monkeypatch.setattr(cli, "LLMClient", lambda *a, **k: object())
    monkeypatch.setattr(cli, "ContentClient", lambda *a, **k: object())
    monkeypatch.setattr(cli, "Pipeline", FailingPipeline)

    rc = cli.main([])
    assert rc == 1


def test_cli_dry_run_success_returns_zero(settings, monkeypatch, capsys):
    from forge.models import RunSummary, SubmitBatch

    class OkPipeline:
        def __init__(self, *a, **k):
            pass

        def run(self, *, dry_run=False):
            return RunSummary(dry_run=dry_run), SubmitBatch(cards=[], pack="madlad-generated")

    monkeypatch.setattr(cli, "load_settings", lambda **k: settings)
    monkeypatch.setattr(cli, "LLMClient", lambda *a, **k: object())
    monkeypatch.setattr(cli, "ContentClient", lambda *a, **k: object())
    monkeypatch.setattr(cli, "Pipeline", OkPipeline)

    rc = cli.main(["--dry-run"])
    assert rc == 0
    assert "cards" in capsys.readouterr().out
