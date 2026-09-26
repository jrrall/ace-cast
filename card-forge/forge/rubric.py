"""Model-estimated comedy dimensions with deterministic quality arithmetic."""
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from .logging_setup import get_logger

# Positional order matches the quality fields listed in the curator prompt.
QUALITY_NAMES = ("playability", "comic_turn", "specificity", "economy", "originality")
QUALITY_WEIGHTS = {'playability': .30, 'comic_turn': .25, 'specificity': .15,
                   'economy': .10, 'originality': .20}
STYLE_NAMES = ('unhinged', 'lewd', 'dark', 'gross', 'blasphemous', 'deadpan', 'implication')
RUBRIC = (
    'Quality rubric, score each dimension 0-5: 0 absent, 1 weak, 2 shaky, '
    '3 workable, 4 strong, 5 exceptional. Playability: a prompt accepts several '
    'unrelated noun phrases; an answer fits several unrelated setups. '
    "Comic_turn: how effectively the card delivers its originating persona's humor. "
    'Specificity: clear, identifiable details. Economy: concise enough to play aloud. '
    'Originality: distinct from other cards in the pool and existing corpus. '
    'Judge within the originating voice; no humor style, subject, or maturity level '
    'automatically earns or loses points. '
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
    # Diagnostic only; a missing explanation must not discard valid scores.
    reason: str | None = Field(default=None, min_length=1)

    @field_validator("quality", mode="before")
    @classmethod
    def _positional_quality(cls, value):
        if isinstance(value, list):
            if len(value) != len(QUALITY_NAMES):
                raise ValueError("quality array must contain exactly five scores")
            # Do not coerce values: QualityScores still enforces integer 0–5,
            # rejecting booleans, strings, fractions, and out-of-range scores.
            return dict(zip(QUALITY_NAMES, value, strict=True))
        return value


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
