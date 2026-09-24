"""Trendscout in isolation: fetched feed items + mocked LLM -> typed Themes."""

from __future__ import annotations

from forge.models import Theme
from forge.personas import Trendscout
from forge.prompts import FEED_OPEN

from conftest import FakeLLM


def test_trendscout_returns_typed_themes(settings, sample_feed_items):
    llm = FakeLLM(
        [
            {
                "themes": [
                    {"title": "Millennial burnout", "angle": "Work is a scam"},
                    {"title": "AI overreach", "angle": "The bots took my job"},
                ]
            }
        ]
    )
    scout = Trendscout(llm, settings, fetch_fn=lambda s: sample_feed_items)
    themes = scout.run()

    assert len(themes) == 2
    assert all(isinstance(t, Theme) for t in themes)
    assert themes[0].title == "Millennial burnout"
    # provenance excerpt preserved from the feed
    assert "goblin" in themes[0].raw_excerpt


def test_trendscout_wraps_feed_as_delimited_data(settings, sample_feed_items):
    llm = FakeLLM([{"themes": [{"title": "X", "angle": "y"}]}])
    Trendscout(llm, settings, fetch_fn=lambda s: sample_feed_items).run()
    # the single LLM call must carry feed text inside the untrusted-data delimiters
    assert FEED_OPEN in llm.calls[0]["user"]


def test_trendscout_caps_theme_count(settings, sample_feed_items):
    settings.themes_per_run = 1
    llm = FakeLLM(
        [{"themes": [{"title": "A", "angle": ""}, {"title": "B", "angle": ""}]}]
    )
    themes = Trendscout(llm, settings, fetch_fn=lambda s: sample_feed_items).run()
    assert len(themes) == 1
