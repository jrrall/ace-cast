"""Typed configuration for Card Forge.

All settings load from environment variables (or a local ``.env``). Secrets are
never hard-coded. See ``.env.example`` for the full list.
"""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, populated from the environment / ``.env``."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,  # allow field-name kwargs (e.g. tests / smoke overrides), not just env aliases
    )

    # --- LLM (OpenAI-compatible litellm gateway) -------------------------------
    llm_base_url: str = Field(default="https://llm.otix.ai", alias="LLM_BASE_URL")
    llm_api_key: str = Field(default="", alias="LLM_API_KEY")
    llm_model: str = Field(default="gpt-4o-mini", alias="LLM_MODEL")
    # Reasoning models (e.g. abliterated Qwen) think before answering, so a
    # per-call budget well above 60s is needed; cold model-loads need even more.
    llm_timeout: float = Field(default=180.0, alias="LLM_TIMEOUT")

    # --- Content API (ace-cast) ------------------------------------------------
    content_api_url: str = Field(
        default="http://localhost:3000", alias="CONTENT_API_URL"
    )
    content_api_token: str = Field(default="", alias="CONTENT_API_TOKEN")
    content_api_timeout: float = Field(default=30.0, alias="CONTENT_API_TIMEOUT")

    # --- Target pack -----------------------------------------------------------
    pack_slug: str = Field(default="madlad-generated", alias="PACK_SLUG")
    maturity_max: int = Field(default=2, alias="MATURITY_MAX")

    # --- Batch sizing ----------------------------------------------------------
    batch_min: int = Field(default=10, alias="BATCH_MIN")
    batch_max: int = Field(default=20, alias="BATCH_MAX")
    themes_per_run: int = Field(default=4, alias="THEMES_PER_RUN")
    cards_per_theme: int = Field(default=8, alias="CARDS_PER_THEME")

    # --- Trendscout feed source ALLOWLIST -------------------------------------
    # Comma-separated list of fully-qualified feed URLs. Only these are fetched;
    # arbitrary scraped URLs are never used. Feed content is treated as untrusted
    # DATA, never as instructions. Operator is responsible for each source's ToS.
    feed_allowlist: str = Field(
        default=(
            "https://www.reddit.com/r/memes/top.json?t=day&limit=25,"
            "https://feeds.bbci.co.uk/news/rss.xml"
        ),
        alias="FEED_ALLOWLIST",
    )
    feed_timeout: float = Field(default=20.0, alias="FEED_TIMEOUT")
    feed_user_agent: str = Field(
        default="card-forge/0.1 (+https://unholy.cards)", alias="FEED_USER_AGENT"
    )

    # --- Content policy deny-list ---------------------------------------------
    # Comma-separated tokens that must never appear (case-insensitive substring)
    # in generated card text. This is a defence-in-depth pre-flight trim; the
    # server runs its own authoritative deny-list. Tune for your audience.
    deny_list: str = Field(
        default="kys,kill yourself,slur",
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
