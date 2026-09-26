import json
import tomllib

import pytest

from conftest import FakeLLM, FakeContentClient, rated_selection
from forge.checkpoint import Checkpoint
from forge.feeds import FeedItem
from forge.llm import LLMError
from forge.persona_registry import BUILTIN_DIR, PHASES, load_personas
from forge.personas.writer import writing_team
from forge.personas.trendscout import Trendscout
from forge.pipeline import Pipeline
from forge.comedy_room import ComedyRoom
from forge.models import Theme


def configure(settings, tmp_path):
    directory = tmp_path/'profiles'
    directory.mkdir()
    for name in ('alpha', 'beta'):
        (directory/f'{name}.toml').write_text(
            f'id = "{name}"\nname = "{name}"\nvoice = "Voice {name}."\n'
            f'[phases]\nscout = "Scout as {name}."\n')
    settings.personas_dir = str(directory)
    settings.persona_scout = True
    settings.themes_per_run = 1
    settings.source_finds_max = 0
    settings.inspiration_per_lane = 0
    settings.cards_per_theme = 6
    return directory


def choices(index, angle):
    return {'themes': [{'title': angle, 'angle': angle, 'source_index': index}]}


def feed():
    return [FeedItem('Headline one', 'news', 'https://example.com/one', 'Excerpt one'),
            FeedItem('Headline two', 'forum', 'https://example.com/two', 'Excerpt two')]


def rest():
    card = {'kind': 'answer', 'text': 'A ceremonial toilet.'}
    return [{'cards': [card]}, {'cards': []}, {'cards': [card]},
            {'verdicts': [{'index': 0, 'allowed': True, 'maturity_rating': 1}]},
            rated_selection([0])]


def test_each_persona_sees_same_pool_but_writes_own_angle(settings, tmp_path):
    configure(settings, tmp_path)
    llm = FakeLLM([choices(0, 'Personal grievance'), choices(1, 'Premium benefit'), *rest()])
    content = FakeContentClient()
    with Checkpoint(tmp_path/'run', settings) as cp:
        summary, batch = Pipeline(settings, llm, content, fetch_fn=lambda _: feed(), checkpoint=cp).run(dry_run=True)
        assert cp.read('scouts/writer.alpha')['themes'][0]['url'] == 'https://example.com/one'
        assert cp.read('scouts/writer.beta')['themes'][0]['raw_excerpt'] == 'Headline two\nExcerpt two'
        assert 'items' in cp.read('research')
    assert llm.calls[0]['user'] == llm.calls[1]['user']
    assert 'Scout as alpha.' in llm.calls[0]['system']
    assert 'Scout as beta.' in llm.calls[1]['system']
    assert 'Personal grievance' in llm.calls[2]['user']
    assert 'Premium benefit' not in llm.calls[2]['user']
    assert 'Premium benefit' in llm.calls[3]['user']
    assert summary.themes == 2
    assert len(batch.cards) == 1
    assert content.submitted == []


def test_resume_reuses_completed_scout_and_original_pool(settings, tmp_path):
    directory = configure(settings, tmp_path)
    def timeout(_):
        raise LLMError('timeout')
    with Checkpoint(tmp_path/'run', settings) as cp:
        with pytest.raises(LLMError):
            Pipeline(settings, FakeLLM([choices(0, 'Original angle'), timeout]), FakeContentClient(),
                     fetch_fn=lambda _: feed(), checkpoint=cp).run(dry_run=True)
    for path in directory.iterdir():
        path.unlink()
    def no_fetch(_):
        pytest.fail('must reuse collected sources')
    settings.persona_scout = False  # saved run mode wins
    llm = FakeLLM([choices(1, 'Second angle'), *rest()])
    with Checkpoint(tmp_path/'run', settings, resume=True) as cp:
        assert cp.persona_scout
        Pipeline(settings, llm, FakeContentClient(), fetch_fn=no_fetch, checkpoint=cp).run(dry_run=True)
    assert 'Scout as beta.' in llm.calls[0]['system']
    assert 'Original angle' in llm.calls[1]['user']
    assert 'Headline one' in llm.calls[0]['user']


@pytest.mark.parametrize('index', [True, -1, 2, '0', None])
def test_scout_rejects_invalid_source_indexes(settings, index):
    settings.llm_json_retries = 0
    writer = writing_team(FakeLLM([]), settings)[0]
    scout = Trendscout(FakeLLM([choices(index, 'Angle')]), settings)
    with pytest.raises(ValueError, match='source_index'):
        scout.for_writer(writer, feed())


def test_scout_schema_retry_preserves_source_metadata(settings):
    llm = FakeLLM([choices(99, 'Wrong'), choices(1, 'Correct')])
    writer = writing_team(llm, settings)[0]
    themes = Trendscout(llm, settings).for_writer(writer, feed())
    assert themes[0].source == 'forum'
    assert themes[0].url == 'https://example.com/two'
    assert 'Repair the response schema' in llm.calls[1]['user']


def test_all_builtins_explicitly_define_every_phase_and_renamed_voice():
    for path in BUILTIN_DIR.glob('*.toml'):
        if path.name != '_defaults.toml':
            with path.open('rb') as source:
                assert set(tomllib.load(source)['phases']) == PHASES
    banned = next(p for p in load_personas() if p.id == 'banned_from_4chan')
    assert banned.name == 'Banned From 4chan'
    assert 'incel' in banned.voice and 'edgelord' in banned.voice
    assert not (BUILTIN_DIR/'banned_from_the_thread.toml').exists()


def test_comedy_room_keeps_each_writers_research_context(settings, tmp_path):
    configure(settings, tmp_path)
    llm = FakeLLM([
        {'cards': [{'kind': 'answer', 'text': 'An elaborate grudge.'}]},
        {'cards': [{'kind': 'answer', 'text': 'A premium apology.'}]},
        {'challenges': []}, {'challenges': []},
    ])
    themes = {'writer.alpha': [Theme(title='Grievance')], 'writer.beta': [Theme(title='Benefit')]}
    ComedyRoom(llm, settings, emit=lambda _: None).run(themes)
    assert 'Grievance' in llm.calls[0]['user'] and 'Benefit' not in llm.calls[0]['user']
    assert 'Benefit' in llm.calls[1]['user']
    assert 'Grievance' in llm.calls[2]['user']
    assert 'Benefit' in llm.calls[3]['user']


@pytest.mark.parametrize('percent', [0, 25, 100])
def test_tabloid_preference_is_identical_across_writers_and_fresh_scouts(settings, percent):
    settings.themes_per_run = 1
    settings.tabloid_percent = percent
    llm = FakeLLM([choices(0, 'Angle') for _ in range(4)])
    writers = writing_team(llm, settings)
    for writer in writers[:2]:
        for _ in range(2):
            Trendscout(llm, settings).for_writer(writer, feed())
    requests = [call['user'] for call in llm.calls]
    assert len(set(requests)) == 1
    assert f'Fictional tabloid target: {percent}%' in requests[0]
    assert 'preference, not a quota' in requests[0]


def test_scout_caps_extra_output_without_retry(settings, caplog):
    settings.themes_per_run = 2
    rows = [*choices(0, 'First')['themes'], *choices(1, 'Second')['themes'],
            {'broken': 'unused extra'}, *choices(0, 'Duplicate extra')['themes']]
    llm = FakeLLM([{'themes': rows}])
    writer = writing_team(llm, settings)[0]
    result = Trendscout(llm, settings).for_writer(writer, feed())
    assert [t.title for t in result] == ['First', 'Second']
    assert len(llm.calls) == 1
    assert len(rows) == 4
    assert 'scout.extra_themes_ignored' in caplog.text


def test_scout_cap_still_validates_retained_rows(settings):
    settings.themes_per_run = 1
    settings.llm_json_retries = 0
    llm = FakeLLM([{'themes': [*choices(99, 'Invalid')['themes'], *choices(0, 'Valid extra')['themes']]}])
    writer = writing_team(llm, settings)[0]
    with pytest.raises(ValueError, match='source_index'):
        Trendscout(llm, settings).for_writer(writer, feed())
