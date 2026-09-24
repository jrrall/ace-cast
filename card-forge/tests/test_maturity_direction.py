"""Maturity targeting is configurable and reaches all creative review stages."""
import pytest
from pydantic import ValidationError
from forge.config import Settings
from forge.personas import Writer, Editor, Curator
from conftest import FakeLLM, FakeContentClient, rated_selection


def test_default_ceiling_allows_extreme():
    assert Settings(_env_file=None).maturity_max == 3


@pytest.mark.parametrize("ceiling", [-1, 4])
def test_ceiling_range(ceiling):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, maturity_max=ceiling)


@pytest.mark.parametrize("ceiling", [0, 1, 2, 3])
def test_creative_stages_receive_configured_intensity(settings, sample_theme, sample_candidates, sample_moderated, ceiling):
    settings.maturity_max = ceiling
    llm = FakeLLM([{"cards": []}, {"cards": []}, rated_selection([])])
    Writer(llm, settings).run(sample_theme)
    Editor(llm, settings).run(sample_candidates)
    Curator(llm, FakeContentClient(), settings).run(sample_moderated)
    for call in llm.calls:
        if ceiling == 3:
            assert "Target extreme adult comedy" in call["system"]
        else:
            assert f"configured maturity ceiling {ceiling}/3" in call["system"]
            assert "Target extreme adult comedy" not in call["system"]
