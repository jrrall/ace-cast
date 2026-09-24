from datetime import date
import random

from forge.tabloid import archive_pick, theme_slots, SOURCE
from forge.feeds import FeedItem
from forge.personas import Trendscout
from conftest import FakeLLM


def entry(year, month_day, title='An impossible divorce'):
    return (f'<a id="year{year}"></a><span class="sya_date">{month_day}<span> </span></span>'
            f'<a class="sya_postlink post-123" href="https://weeklyworldnews.com/story/{year}/">{title}</a>')


def test_anniversary_uses_random_available_past_year_and_keeps_provenance():
    html = entry(2010, 'September 24') + entry(2012, 'September 24') + entry(2026, 'September 24')
    picks = [archive_pick(html, date(2026, 9, 24), random.Random(i)) for i in range(20)]
    assert {p[0].year for p in picks} == {2010, 2012}
    assert all(p[3] == 'same month/day' for p in picks)
    assert all(p[2].endswith(f'{p[0].year}/') for p in picks)


def test_missing_day_falls_back_honestly_and_missing_month_returns_none():
    html = entry(2010, 'September 20')
    assert 'fallback' in archive_pick(html, date(2026, 9, 24))[3]
    assert archive_pick(html, date(2026, 2, 28)) is None
    assert archive_pick(entry(2012, 'February 29'), date(2028, 2, 29))[0] == date(2012, 2, 29)


def test_percentage_rounding_and_disabled():
    assert theme_slots(4, 25) == 1
    assert theme_slots(4, 100) == 4
    assert theme_slots(4, 0) == 0
    counts = [theme_slots(1, 25, random.Random(i)) for i in range(1000)]
    assert 200 < sum(counts) < 300


def test_scout_reserves_tabloid_share_without_extra_llm_call(settings):
    settings.themes_per_run = 4
    settings.tabloid_percent = 25
    llm = FakeLLM([{'themes': [{'title': str(i)} for i in range(4)]}])
    story = FeedItem(title='An impossible divorce', source=SOURCE,
                     url='https://weeklyworldnews.com/story/', excerpt='Fictional. Published 2012-09-24.')
    themes = Trendscout(llm, settings, fetch_fn=lambda _: [story]).run()
    assert len(themes) == 4
    assert len(llm.calls) == 1
    assert sum(t.source == SOURCE for t in themes) == 1
    assert themes[-1].url == story.url
    assert '2012-09-24' in themes[-1].raw_excerpt
    settings.tabloid_percent = 100
    themes = Trendscout(FakeLLM([]), settings, fetch_fn=lambda _: [story]).run()
    assert len(themes) == 4
    assert len({t.angle for t in themes}) == 4
