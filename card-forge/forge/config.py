"""Typed configuration for Card Forge.

All settings load from environment variables (or a local ``.env``). Secrets are
never hard-coded. See ``.env.example`` for the full list.
"""

from __future__ import annotations

from pydantic import Field, field_validator
from .rubric import QUALITY_WEIGHTS
import math
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, populated from the environment / ``.env``."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,  # allow field-name kwargs (e.g. tests / smoke overrides), not just env aliases
    )

    # --- LLM (OpenAI-compatible API, including local Ollama) -------------------
    llm_base_url: str = Field(default="http://localhost:11434/v1", alias="LLM_BASE_URL")
    llm_api_key: str = Field(default="", alias="LLM_API_KEY")
    llm_model: str = Field(default="huihui_ai/qwen3-abliterated:8b", alias="LLM_MODEL")
    llm_timeout: float = Field(default=115.0, gt=0, alias="LLM_TIMEOUT")
    llm_max_retries: int = Field(default=0, ge=0, alias="LLM_MAX_RETRIES")
    llm_json_retries: int = Field(default=1, ge=0, le=2, alias="LLM_JSON_RETRIES")
    # Omit vendor-specific reasoning settings unless explicitly configured.
    llm_reasoning_effort: str = Field(default="", alias="LLM_REASONING_EFFORT")

    # --- Content API (ace-cast) ------------------------------------------------
    content_api_url: str = Field(
        default="http://localhost:3000", alias="CONTENT_API_URL"
    )
    content_api_token: str = Field(default="", alias="CONTENT_API_TOKEN")
    content_api_timeout: float = Field(default=30.0, alias="CONTENT_API_TIMEOUT")

    # --- Target pack -----------------------------------------------------------
    pack_slug: str = Field(default="madlad-generated", alias="PACK_SLUG")
    maturity_max: int = Field(default=3, ge=0, le=3, alias="MATURITY_MAX")

    source_finds_max: int = Field(default=6, ge=0, le=12, alias="SOURCE_FINDS_MAX")
    persona_scout: bool = Field(default=True, alias="PERSONA_SCOUT")
    personas_dir: str = Field(default="", alias="PERSONAS_DIR")
    writers_per_run: int = Field(default=0, ge=0, alias="WRITERS_PER_RUN")
    comedy_loop: bool = Field(default=False, alias="COMEDY_LOOP")
    comedy_trace_path: str = Field(default="", alias="COMEDY_TRACE_PATH")

    moderator_batch_size: int = Field(default=12, ge=1, le=50, alias="MODERATOR_BATCH_SIZE")
    curator_batch_size: int = Field(default=8, ge=1, le=50, alias="CURATOR_BATCH_SIZE")
    editor_batch_size: int = Field(default=12, ge=1, le=50, alias="EDITOR_BATCH_SIZE")

    # --- Batch sizing ----------------------------------------------------------
    batch_min: int = Field(default=0, alias="BATCH_MIN")  # legacy; no minimum enforced
    batch_max: int = Field(default=50, ge=1, le=50, alias="BATCH_MAX")
    themes_per_run: int = Field(default=4, alias="THEMES_PER_RUN")
    cards_per_theme: int = Field(default=8, ge=6, alias="CARDS_PER_THEME")

    quality_min: float = Field(default=70, ge=0, le=100, alias="QUALITY_MIN")
    quality_weights: dict[str, float] = Field(default_factory=lambda: dict(QUALITY_WEIGHTS), alias="QUALITY_WEIGHTS")

    @field_validator("quality_weights")
    @classmethod
    def _valid_weights(cls, value):
        if set(value) != set(QUALITY_WEIGHTS) or any(not math.isfinite(v) or v < 0 for v in value.values()):
            raise ValueError("quality weights must specify all five dimensions with finite nonnegative values")
        if not math.isclose(sum(value.values()), 1, abs_tol=1e-6):
            raise ValueError("quality weights must sum to 1")
        return value

    # --- Trendscout feed source ALLOWLIST -------------------------------------
    # Comma-separated list of fully-qualified feed URLs. Only these are fetched;
    # arbitrary scraped URLs are never used. Feed content is treated as untrusted
    # DATA, never as instructions. Operator is responsible for each source's ToS.
    # Reddit is deliberately NOT here: it serves an HTML interstitial (403) to
    # unauthenticated clients on both .json and .rss, regardless of User-Agent.
    # Only a logged-in browser gets data. Use their OAuth API if you want Reddit.
    feed_allowlist: str = Field(
        default=(
            "https://knowyourmeme.com/newsfeed.rss,"
            "https://feeds.bbci.co.uk/news/rss.xml,"
            "https://www.theguardian.com/world/rss,"
            "https://feeds.npr.org/1001/rss.xml,"
            "https://arstechnica.com/feed/,"
            "https://www.404media.co/rss/,"
            "https://www.theguardian.com/lifeandstyle/rss,"
            "https://www.loc.gov/collections/today-in-history/?fo=json,"
            "https://weeklyworldnews.com/archive/,"
            "https://b3ta.com/questions/imagechallenge/,"
            "https://archive.org/wayback/available?url=infowars.com"
        ),
        alias="FEED_ALLOWLIST",
    )
    feed_timeout: float = Field(default=20.0, alias="FEED_TIMEOUT")
    feed_user_agent: str = Field(
        default="card-forge/0.1 (+https://unholy.cards)", alias="FEED_USER_AGENT"
    )

    # Local fictional seeds per lane (everyday + off-the-cuff); 0 disables both.
    inspiration_per_lane: int = Field(default=3, ge=0, le=8, alias="INSPIRATION_PER_LANE")

    tabloid_percent: float = Field(default=25, ge=0, le=100, alias="TABLOID_PERCENT")

    # --- Content policy deny-list ---------------------------------------------
    # Comma-separated tokens that must never appear (case-insensitive substring)
    # in generated card text. This is a defence-in-depth pre-flight trim; the
    # server runs its own authoritative deny-list. Tune for your audience.
    deny_list: str = Field(
        default="",
        alias="DENY_LIST",
    )

    @property
    def feed_urls(self) -> list[str]:
        return [u.strip() for u in self.feed_allowlist.split(",") if u.strip()]

    @property
    def deny_terms(self) -> list[str]:
        return [t.strip().lower() for t in self.deny_list.split(",") if t.strip()]


def load_settings(**overrides: object) -> Settings:
    """Load settings, allowing explicit overrides (used by tests)."""
    return Settings(**overrides)
