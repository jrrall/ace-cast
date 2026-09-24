import pytest
from forge.config import Settings
from forge.rubric import QualityScores, QUALITY_WEIGHTS


def test_weighted_score_and_configuration():
    assert QualityScores(playability=5, comic_turn=4, specificity=3, economy=2, originality=1).total(QUALITY_WEIGHTS) == 67
    for weights in [{}, dict.fromkeys(QUALITY_WEIGHTS, 1), {**QUALITY_WEIGHTS, 'economy': -0.1}]:
        with pytest.raises(ValueError):
            Settings(_env_file=None, quality_weights=weights)
