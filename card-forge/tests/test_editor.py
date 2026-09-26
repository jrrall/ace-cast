"""Editor in isolation: candidates + mocked LLM -> tightened candidates."""

from __future__ import annotations

from forge.personas import Editor

from conftest import FakeLLM


def test_editor_drops_invalid_and_dupes(settings, sample_candidates):
    llm = FakeLLM(
        [
            {
                "cards": [
                    {"kind": "answer", "text": "A haunted Roomba."},
                    {"kind": "answer", "text": "A haunted Roomba."},  # dup
                    {"kind": "prompt", "text": "broken prompt no blank"},  # invalid
                    {"kind": "answer", "text": "Crippling student debt."},
                ]
            }
        ]
    )
    edited = Editor(llm, settings).run(sample_candidates)
    texts = [c.text for c in edited]
    assert texts == ["A haunted Roomba.", "Crippling student debt."]


def test_editor_empty_input_skips_llm(settings):
    llm = FakeLLM([])  # would raise if called
    assert Editor(llm, settings).run([]) == []
    assert llm.calls == []


def test_chunking_preserves_local_provenance_and_dedupes_across_chunks(settings):
    from forge.models import CardCandidate

    settings.editor_batch_size = 2
    candidates = [CardCandidate(
        kind="answer", text=f"Original {i}.", writer=f"writer.{i}",
        generation_route="paired_revision", source_url=f"https://example.com/{i}",
    ) for i in range(3)]
    llm = FakeLLM([
        {"cards": [
            {"source_index": 0, "kind": "answer", "text": "Shared edit."},
            {"source_index": 1, "kind": "answer", "text": "Unique first edit."},
        ]},
        {"cards": [
            {"source_index": 0, "kind": "answer", "text": "shared edit."},
            {"source_index": 0, "kind": "answer", "text": "Unique second edit."},
        ]},
    ])
    edited = Editor(llm, settings).run(candidates)
    assert len(llm.calls) == 2
    assert "Original 2." not in llm.calls[0]["user"]
    assert "0. [answer] Original 2." in llm.calls[1]["user"]
    assert [c.writer for c in edited] == ["writer.0", "writer.1", "writer.2"]
    assert edited[-1].source_url == "https://example.com/2"
    assert edited[-1].generation_route == "paired_revision"


def test_failed_editor_chunk_does_not_return_partial_results(settings, sample_candidates):
    import pytest
    from forge.llm import LLMError

    settings.editor_batch_size = 2

    def timeout(_):
        raise LLMError("Request timed out")

    llm = FakeLLM([
        {"cards": [{"source_index": 1, "kind": "answer", "text": "A haunted Roomba."}]},
        timeout,
    ])
    with pytest.raises(LLMError, match="timed out"):
        Editor(llm, settings).run(sample_candidates)
    assert len(llm.calls) == 2
