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
