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
                    {"title": "Millennial burnout", "angle": "Work is a scam", "source_index": 0},
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


def test_theme_gets_only_selected_source_context(settings):
    from forge.feeds import FeedItem
    settings.inspiration_per_lane = 0
    items = [FeedItem(title="Viking music", source="news"),
             FeedItem(title="Court etiquette", source="history", url="https://example.com/history",
                      excerpt="A dispute over seating precedence.")]
    llm = FakeLLM([{"themes": [{"title": "Petty protocol", "source_index": 1},
                              {"title": "Missing source", "source_index": 999}]}])
    themes = Trendscout(llm, settings, fetch_fn=lambda _: items).run()
    assert themes[0].source == "history"
    assert themes[0].url == items[1].url
    assert "seating precedence" in themes[0].raw_excerpt
    assert "Viking" not in themes[0].raw_excerpt
    assert themes[1].raw_excerpt == ""
    assert themes[1].source == "unspecified"


def test_fictional_seeds_are_labeled_and_can_be_disabled(settings):
    llm = FakeLLM([{"themes": []}, {"themes": []}])
    Trendscout(llm, settings, fetch_fn=lambda _: []).run()
    assert "fictional:everyday" in llm.calls[0]["user"]
    assert "fictional:off-the-cuff" in llm.calls[0]["user"]
    settings.inspiration_per_lane = 0
    Trendscout(llm, settings, fetch_fn=lambda _: []).run()
    assert "fictional:" not in llm.calls[1]["user"]
