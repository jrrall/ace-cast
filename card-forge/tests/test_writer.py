"""Writer in isolation: a Theme + mocked LLM -> typed CardCandidates."""

from __future__ import annotations

from forge.models import BLANK_MARKER, CardCandidate
from forge.personas import Writer

from conftest import FakeLLM


def test_writer_produces_valid_candidates(settings, sample_theme):
    llm = FakeLLM(
        [
            {
                "cards": [
                    {"kind": "prompt", "text": "Work is just ____ with extra steps."},
                    {"kind": "answer", "text": "Crippling student debt."},
                ]
            }
        ]
    )
    cards = Writer(llm, settings).run(sample_theme)

    assert len(cards) == 2
    assert all(isinstance(c, CardCandidate) for c in cards)
    prompt = next(c for c in cards if c.kind == "prompt")
    assert BLANK_MARKER in prompt.text
    assert prompt.blanks == 1


def test_writer_drops_structurally_invalid_cards(settings, sample_theme):
    # a "prompt" with no blank and an "answer" containing a blank are both invalid
    llm = FakeLLM(
        [
            {
                "cards": [
                    {"kind": "prompt", "text": "No blank here."},
                    {"kind": "answer", "text": "Answers should not have ____."},
                    {"kind": "answer", "text": "A goose with a knife."},
                ]
            }
        ]
    )
    cards = Writer(llm, settings).run(sample_theme)
    assert len(cards) == 1
    assert cards[0].text == "A goose with a knife."


def test_writer_makes_exactly_one_llm_call(settings, sample_theme):
    llm = FakeLLM([{"cards": [{"kind": "answer", "text": "Tax fraud."}]}])
    Writer(llm, settings).run(sample_theme)
    assert len(llm.calls) == 1


def test_writer_caps_model_overproduction(settings, sample_theme):
    settings.cards_per_theme = 2
    llm = FakeLLM([{'cards': [
        {'kind': 'answer', 'text': f'An original answer {i}'} for i in range(5)
    ]}])
    assert len(Writer(llm, settings).run(sample_theme)) == 1


def test_prompt_first_overproduction_keeps_answer_slots(settings, sample_theme):
    settings.cards_per_theme = 4
    llm = FakeLLM([{"cards": [
        *[{"kind": "prompt", "text": f"Setup {i}: ____."} for i in range(6)],
        *[{"kind": "answer", "text": f"Answer {i}."} for i in range(6)],
    ]}])
    cards = Writer(llm, settings).run(sample_theme)
    assert [c.kind for c in cards] == ["prompt", "prompt", "answer", "answer"]
    assert "up to 2 prompt cards and 2 answer cards" in llm.calls[0]["user"]


def test_single_slot_requests_answer(settings, sample_theme):
    settings.cards_per_theme = 1
    llm = FakeLLM([{"cards": [
        {"kind": "prompt", "text": "Setup: ____."},
        {"kind": "answer", "text": "An answer."},
    ]}])
    assert [c.kind for c in Writer(llm, settings).run(sample_theme)] == ["answer"]
