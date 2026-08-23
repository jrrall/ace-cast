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
    # Capped just under the gateway's Cloudflare edge, which returns 524 if the
    # origin has not answered within 120s. A client timeout above that is dead
    # time: the connection is already gone, and we would sit waiting for a
    # response Cloudflare abandoned. Reasoning models still need well over the
    # SDK's default, so this is the usable ceiling, not a comfortable budget --
    # if calls routinely 524, the fix is a faster model or a longer edge
    # timeout, not a bigger number here.
    llm_timeout: float = Field(default=115.0, alias="LLM_TIMEOUT")
    # The OpenAI SDK retries twice by DEFAULT, silently. Against a flaky gateway
    # that turns one stuck call into 3 x llm_timeout with nothing in the log --
    # a run can burn most of an hour looking like it is simply thinking. Pin it
    # low and log every attempt instead.
    llm_max_retries: int = Field(default=1, alias="LLM_MAX_RETRIES")

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
    # Reddit is deliberately NOT here: it serves an HTML interstitial (403) to
    # unauthenticated clients on both .json and .rss, regardless of User-Agent.
    # Only a logged-in browser gets data. Use their OAuth API if you want Reddit.
    feed_allowlist: str = Field(
        default=(
            "https://knowyourmeme.com/newsfeed.rss,"
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
