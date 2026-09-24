"""Model-estimated comedy dimensions with deterministic quality arithmetic."""
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from .logging_setup import get_logger

QUALITY_WEIGHTS = {'playability': .30, 'comic_turn': .25, 'specificity': .15,
                   'economy': .10, 'originality': .20}
STYLE_TARGETS = {
    'writer.deadpan': [1, 1, 3, 1, 2, 5, 4],
    'writer.unhinged': [5, 3, 4, 3, 3, 2, 4],
    'writer.pr_spin_doctor': [2, 1, 3, 1, 4, 4, 3],
    'writer.petty_villain': [3, 2, 2, 1, 2, 3, 5],
    'writer.banned_from_the_thread': [4, 4, 4, 3, 4, 4, 5],
}
STYLE_NAMES = ('unhinged', 'lewd', 'dark', 'gross', 'blasphemous', 'deadpan', 'implication')
RUBRIC = (
    'Quality rubric, score each dimension 0-5: 0 broken/absent, 1 weak, 2 shaky, '
    '3 workable, 4 strong, 5 exceptional. Playability: a prompt accepts several '
    'unrelated noun phrases naturally; an answer fits several unrelated setups. '
    'Comic_turn: a reversal or revealing implication, not just filling a category. '
    'Specificity: a concrete recognizable situation. Economy: no expendable '
    'explanation or clauses. Originality: a distinct premise, not another card '
    'with the nouns swapped. Test combinations mentally before scoring. '
    'For playability, try varied mundane, personal, and absurd noun phrases or '
    'setups; one imagined matching answer is insufficient. '
    'Style dimensions are intensity, NOT quality: unhinged (disproportionate '
    'escalation), lewd (sexual innuendo), dark (gallows humor), gross (bodily '
    'disgust), blasphemous (irreverence toward sacred authority), deadpan '
    '(matter-of-fact delivery), implication (narrator/player implicated). '
    'Each ranges 0 absent to 5 dominant. Lewdness and shock cannot rescue a '
    'broken or unfunny joke. Playful silliness can score highly without either. '
)


class QualityScores(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    playability: int = Field(ge=0, le=5)
    comic_turn: int = Field(ge=0, le=5)
    specificity: int = Field(ge=0, le=5)
    economy: int = Field(ge=0, le=5)
    originality: int = Field(ge=0, le=5)

    def total(self, weights: dict[str, float]) -> float:
        return round(20 * sum(self.model_dump()[key] * weight for key, weight in weights.items()), 2)


class StyleScores(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    unhinged: int = Field(ge=0, le=5)
    lewd: int = Field(ge=0, le=5)
    dark: int = Field(ge=0, le=5)
    gross: int = Field(ge=0, le=5)
    blasphemous: int = Field(ge=0, le=5)
    deadpan: int = Field(ge=0, le=5)
    implication: int = Field(ge=0, le=5)


class Evaluation(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    index: int = Field(ge=0)
    quality: QualityScores
    style: StyleScores | None = None
    premise_group: str = Field(min_length=1)
    reason: str = Field(min_length=1)


    @field_validator("style", mode="before")
    @classmethod
    def _optional_style(cls, value):
        if value is None:
            return None
        try:
            return StyleScores.model_validate(value)
        except ValidationError:
            # Style is diagnostic only; never fabricate scores or relax quality.
            get_logger().warning("curator.invalid_style_ignored")
            return None
