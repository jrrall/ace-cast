import pytest
from forge.config import Settings
from forge.rubric import QualityScores, QUALITY_WEIGHTS


def test_weighted_score_and_configuration():
    assert QualityScores(playability=5, comic_turn=4, specificity=3, economy=2, originality=1).total(QUALITY_WEIGHTS) == 67
    for weights in [{}, dict.fromkeys(QUALITY_WEIGHTS, 1), {**QUALITY_WEIGHTS, 'economy': -0.1}]:
        with pytest.raises(ValueError):
            Settings(_env_file=None, quality_weights=weights)


@pytest.mark.parametrize("style", [None, {}, {"dead,pan": 5}, "invalid", {"deadpan": True}])
def test_style_is_optional_diagnostic(style):
    from forge.rubric import Evaluation
    evaluation = Evaluation.model_validate({
        "index": 0, "quality": dict.fromkeys(QUALITY_WEIGHTS, 4),
        "premise_group": "test", "reason": "Concrete turn.", "style": style,
    })
    assert evaluation.style is None
    assert evaluation.quality.total(QUALITY_WEIGHTS) == 80
