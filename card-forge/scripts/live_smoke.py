#!/usr/bin/env python3
"""Light LIVE smoke test of the agent chain against the configured OpenAI-compatible server.

Runs the full chain (Trendscout -> six writers -> Editor -> Moderator ->
Curator) making REAL calls to the configured LLM server, but WITHOUT needing the
ace-cast game server:
  * the content corpus (Curator's dedupe source) is stubbed to empty, and
  * the trend feeds are canned, so no Reddit/BBC network dependency.

It prints the assembled batch and never POSTs anything. This exercises exactly
one thing the unit tests can't: that the chain can actually talk to the LLM and
get well-formed cards back.

Run (maps the shell's LITELLM_API_KEY -> the forge's LLM_API_KEY):

    cd card-forge
    LLM_API_KEY="$LITELLM_API_KEY" LLM_MODEL="<a-model-id-on-your-gateway>" \
        uv run python scripts/live_smoke.py

Set LLM_MODEL to a model your gateway actually serves (list them with:
`curl -s $LLM_BASE_URL/v1/models -H "Authorization: Bearer $LITELLM_API_KEY"`).
"""

from __future__ import annotations

import argparse
import json
import os
import sys

# Allow running from the card-forge dir without an install.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from forge.config import load_settings  # noqa: E402
from forge.feeds import FeedItem, fetch_feed_items  # noqa: E402
from forge.llm import LLMClient  # noqa: E402
from forge.models import RunSummary, Theme  # noqa: E402
from forge.pipeline import Pipeline  # noqa: E402
from forge.personas import Trendscout, writing_team  # noqa: E402

# Fictional sample headlines, not claims about actual news events.
CANNED_FEED = [
    FeedItem(title="Fictional: influencer's apology video includes a sponsor discount code", source="fictional"),
    FeedItem(title="Fictional: babysitting startup replaces background checks with follower counts", source="fictional"),
    FeedItem(title="Fictional: dating app sells a subscription to explain why someone left you on read", source="fictional"),
    FeedItem(title="Fictional: luxury survival retreat charges extra for drinking water", source="fictional"),
]


class _StubContentClient:
    """Stands in for the ace-cast content API so no server is needed.

    Empty corpus => Curator dedupes against nothing (every card is 'new').
    """

    def list_cards(self, **_kwargs) -> list[dict]:
        return []


def _canned_fetch(_settings) -> list[FeedItem]:
    return CANNED_FEED


def main() -> int:
    parser = argparse.ArgumentParser(description="Test Card Forge without the game API.")
    parser.add_argument("--writers-only", action="store_true",
                        help="Research once and print each writer's raw drafts as JSON lines; skip review.")
    parser.add_argument("--live-research", action="store_true",
                        help="Use configured public research feeds instead of fictional sample headlines.")
    parser.add_argument("--comedy-loop", action="store_true", help="One paired challenge/revision round.")
    parser.add_argument("--theme", help="Fixed theme; bypass research for a controlled comparison.")
    args = parser.parse_args()
    if args.theme and not args.writers_only:
        parser.error("--theme requires --writers-only")
    api_key = os.environ.get("LLM_API_KEY") or os.environ.get("LITELLM_API_KEY", "")
    # Small sizes keep this LIGHT: 1 theme, a few cards per theme.
    settings = load_settings(
        llm_api_key=api_key,
        **({"comedy_loop": True} if args.comedy_loop else {}),
        themes_per_run=int(os.environ.get("THEMES_PER_RUN", "1")),
        cards_per_theme=int(os.environ.get("CARDS_PER_THEME", "6")),
    )
    print(
        f"[live-smoke] gateway={settings.llm_base_url}  model={settings.llm_model}  "
        f"themes={settings.themes_per_run}  cards/theme={settings.cards_per_theme}",
        file=sys.stderr,
    )

    llm = LLMClient(settings)
    fetch_fn = fetch_feed_items if args.live_research else _canned_fetch
    pipeline = Pipeline(settings, llm, _StubContentClient(), fetch_fn=fetch_fn)

    summary = RunSummary(dry_run=True)
    try:
        if args.writers_only:
            themes = [Theme(title=args.theme)] if args.theme else Trendscout(llm, settings, fetch_fn).run()
            if settings.comedy_loop:
                from forge.comedy_room import ComedyRoom
                cards = ComedyRoom(llm, settings, emit=lambda event: print(json.dumps(event, ensure_ascii=False), flush=True)).run(themes)
                return 0 if cards else 1
            count = 0
            for writer in writing_team(llm, settings):
                for theme in themes:
                    cards = writer.run(theme)
                    count += len(cards)
                    print(json.dumps({
                        "persona": writer.name, "theme": theme.title,
                        "source_url": theme.url, "research": theme.raw_excerpt,
                        "cards": [card.model_dump() for card in cards],
                    }, ensure_ascii=False), flush=True)
            return 0 if count else 1
        batch = pipeline.build_batch(summary)
    except Exception as exc:  # noqa: BLE001 - a smoke test should report, not traceback
        print(f"[live-smoke] chain failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        if "1033" in str(exc) or "530" in str(exc):
            print(
                "[live-smoke] -> the litellm gateway is unreachable (Cloudflare tunnel "
                "down at the origin). Bring the origin/cloudflared back up and retry.",
                file=sys.stderr,
            )
        return 1

    print(f"[live-smoke] {summary.as_line()}", file=sys.stderr)
    print(json.dumps(batch.payload(), indent=2, ensure_ascii=False))
    if not batch.cards:
        print("[live-smoke] WARNING: chain produced 0 cards.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
