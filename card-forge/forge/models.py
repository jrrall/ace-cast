"""Typed pydantic contracts for every stage boundary of the agent chain.

The pipeline is:

    feeds -> Trendscout -> [Theme]
          -> Writer      -> [CardCandidate]
          -> Editor      -> [CardCandidate]
          -> Moderator   -> [ModeratedCard]
          -> Curator     -> SubmitBatch

Each arrow is a declared model so a persona can be unit-tested in isolation
(typed input in, typed output asserted) with a mocked LLM.

Card conventions mirror ``ace-cast/src/game/data/madladCards.js``:
  * prompts ("black" cards) contain the blank marker ``____`` and are ``kind='prompt'``
  * answers ("white" cards) are short phrases and are ``kind='answer'``
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

BLANK_MARKER = "____"

Kind = Literal["prompt", "answer"]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Theme(BaseModel):
    """A single trend/topic distilled from an allow-listed feed.

    ``raw_excerpt`` is untrusted feed DATA; it is only ever injected into
    downstream prompts inside explicit delimiters, never as instructions.
    """

    title: str
    angle: str = ""
    source: str = "feed"
    url: str = ""
    raw_excerpt: str = ""
    fetched_at: datetime = Field(default_factory=_utcnow)

    @field_validator("title", "angle", "source", "url", "raw_excerpt")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @field_validator("title")
    @classmethod
    def _title_nonempty(cls, v: str) -> str:
        if not v:
            raise ValueError("theme title must not be empty")
        return v


class CardCandidate(BaseModel):
    """A generated card before moderation.

    Structural invariants are enforced here so malformed LLM output raises on
    construction (personas catch and drop rejects). ``blanks`` is coerced to the
    true marker count for prompts, so downstream never trusts a bad count.
    """

    kind: Kind
    text: str
    blanks: int = 0

    @field_validator("text")
    @classmethod
    def _strip_text(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("card text must not be empty")
        return v

    @model_validator(mode="after")
    def _enforce_kind_shape(self) -> "CardCandidate":
        marker_count = self.text.count(BLANK_MARKER)
        if self.kind == "prompt":
            if marker_count == 0:
                raise ValueError(f"prompt must contain the blank marker {BLANK_MARKER!r}")
            # coerce to the real count regardless of what the model claimed
            object.__setattr__(self, "blanks", marker_count)
        else:  # answer
            if marker_count != 0:
                raise ValueError("answer must not contain the blank marker")
            object.__setattr__(self, "blanks", 0)
        return self


class ModeratedCard(CardCandidate):
    """A candidate that has passed moderation and carries a maturity rating."""

    maturity_rating: int = Field(ge=0, le=3)


class SubmitCard(BaseModel):
    """A card as sent to ``POST /api/content/cards``.

    Re-validates the structural invariants independently of the candidate models
    so the assembled batch is provably well-formed even if built by hand.
    """

    kind: Kind
    text: str
    blanks: int
    maturity_rating: int = Field(ge=0, le=3)
    pack: str

    @field_validator("text")
    @classmethod
    def _strip_text(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("card text must not be empty")
        return v

    @model_validator(mode="after")
    def _enforce_shape(self) -> "SubmitCard":
        marker_count = self.text.count(BLANK_MARKER)
        if self.kind == "prompt":
            if marker_count == 0:
                raise ValueError(f"prompt must contain the blank marker {BLANK_MARKER!r}")
            if self.blanks != marker_count:
                raise ValueError("blanks must equal the number of blank markers")
        else:
            if marker_count != 0:
                raise ValueError("answer must not contain the blank marker")
            if self.blanks != 0:
                raise ValueError("answer must have blanks == 0")
        return self

    @classmethod
    def from_moderated(cls, card: ModeratedCard, pack: str) -> "SubmitCard":
        return cls(
            kind=card.kind,
            text=card.text,
            blanks=card.blanks,
            maturity_rating=card.maturity_rating,
            pack=pack,
        )


class SubmitBatch(BaseModel):
    """The final assembled batch handed to the content client."""

    cards: list[SubmitCard] = Field(default_factory=list)
    pack: str = "madlad-generated"
    generated_at: datetime = Field(default_factory=_utcnow)

    def payload(self) -> dict:
        """JSON body for ``POST /api/content/cards``."""
        return {
            "cards": [
                {
                    "kind": c.kind,
                    "text": c.text,
                    "blanks": c.blanks,
                    "maturity_rating": c.maturity_rating,
                    "pack": c.pack,
                }
                for c in self.cards
            ]
        }


class SubmitResult(BaseModel):
    """Server response from ``POST /api/content/cards``."""

    created: list[int] = Field(default_factory=list)
    skipped: int = 0
    rejected: list[dict] = Field(default_factory=list)


class RunSummary(BaseModel):
    """Per-run observability report."""

    themes: int = 0
    generated: int = 0
    edited: int = 0
    moderated: int = 0
    deduped: int = 0
    assembled: int = 0
    submitted: int = 0
    skipped: int = 0
    rejected: int = 0
    dry_run: bool = False

    def as_line(self) -> str:
        return (
            f"themes={self.themes} generated={self.generated} edited={self.edited} "
            f"moderated={self.moderated} deduped={self.deduped} "
            f"assembled={self.assembled} submitted={self.submitted} "
            f"skipped={self.skipped} rejected={self.rejected} dry_run={self.dry_run}"
        )
