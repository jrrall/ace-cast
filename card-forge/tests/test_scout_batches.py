import json

import pytest

from conftest import FakeContentClient, FakeLLM
from forge.checkpoint import Checkpoint
from forge.feeds import FeedItem
from forge.llm import LLMError
from forge.personas.writer import writing_team
from forge.pipeline import Pipeline
from forge.scout_batches import make_batches, scout_batches, scout_team, validate
from forge.stories import stories_from_items
from test_persona_scout import configure, feed


def pool(count=24):
    return stories_from_items([FeedItem(f'Story {i}', f'source {i // 8}',
                                       f'https://example.com/{i}', f'Full excerpt {i}')
                               for i in range(count)])


def selected(call):
    payload = json.loads(call['user'])
    return {'theme': {'story_id': payload['stories'][0]['id'], 'title': 'Selected',
                      'angle': 'Alpha angle' if 'Scout as alpha.' in call['system'] else 'Beta angle'}}


def timeout(_):
    raise LLMError('timeout')


def test_assignments_mix_sources_share_anchors_and_rotate_without_repeats():
    stories = pool()
    a = make_batches(stories, 0, 6, 2)
    b = make_batches(stories, 1, 6, 2)
    assert a == make_batches(stories, 0, 6, 2)
    assert [x[0] for x in a] == [x[0] for x in b]
    assert [x[1:] for x in a] != [x[1:] for x in b]
    for batches in (a, b):
        ids = [s['id'] for batch in batches for s in batch]
        assert len(ids) == len(set(ids)) == 12
        assert all(len({s['source'] for s in batch}) > 1 for batch in batches)


@pytest.mark.parametrize('length,size,count', [(0, 6, 2), (1, 6, 2), (4, 6, 2), (7, 6, 2),
                                              (24, 1, 2), (24, 6, 0), (24, 6, -1)])
def test_small_pools_never_repeat_or_invent(length, size, count):
    stories = pool(length)
    batches = make_batches(stories + stories, 3, size, count)
    ids = [s['id'] for batch in batches for s in batch]
    assert len(batches) <= max(0, count)
    assert all(0 < len(batch) <= size for batch in batches)
    assert len(ids) == len(set(ids))
    assert set(ids) <= {s['id'] for s in stories}
    if count > 0:
        assert len(ids) == min(length, size * count)


@pytest.mark.parametrize('row', [None, [], {}, {'themes': []}, {'theme': []}, {'theme': True},
    {'theme': {'story_id': False, 'title': 'T', 'angle': 'A'}},
    {'theme': {'story_id': 'unknown', 'title': 'T', 'angle': 'A'}}])
def test_invalid_response_shape_or_identity(row):
    with pytest.raises(ValueError):
        validate(row, pool(2))


@pytest.mark.parametrize('field,value', [('title', ''), ('title', '  '), ('angle', 4), ('angle', None)])
def test_invalid_retained_text(field, value):
    stories = pool(2)
    row = {'story_id': stories[0]['id'], 'title': 'T', 'angle': 'A', field: value}
    with pytest.raises(ValueError):
        validate({'theme': row}, stories)


def test_out_of_batch_story_and_forged_provenance():
    stories = pool(2)
    row = {'story_id': stories[1]['id'], 'title': 'T', 'angle': 'A', 'url': 'forged'}
    with pytest.raises(ValueError):
        validate({'theme': row}, stories[:1])
    theme = validate({'theme': row}, stories)
    assert theme.url == stories[1]['url']
    assert theme.raw_excerpt.endswith(stories[1]['excerpt'])
    assert validate({'theme': None}, stories) is None


@pytest.mark.parametrize('first', [selected, {'theme': None}])
def test_timeout_within_persona_resumes_completed_selection_or_null(settings, tmp_path, first):
    directory = configure(settings, tmp_path)
    settings.themes_per_run = 2
    settings.scout_batch_size = 2
    items = [FeedItem(f'Headline {i}', f'source {i % 2}', f'https://example.com/{i}', 'Excerpt')
             for i in range(4)]
    with Checkpoint(tmp_path/'run', settings) as cp:
        with pytest.raises(LLMError):
            Pipeline(settings, FakeLLM([first, timeout]), FakeContentClient(),
                     fetch_fn=lambda _: items, checkpoint=cp).run(dry_run=True)
        saved = cp.read('scout_batches/writer.alpha/0')
        assert len(saved['story_ids']) == 2
        assert (saved['theme'] is None) == (first == {'theme': None})
        original_plan = cp.read('scout_plan')
        assert cp.read('scout_batches/writer.alpha/1') is None
    for path in directory.iterdir():
        path.unlink()
    settings.persona_scout = False  # saved mode and definitions take precedence
    llm = FakeLLM([selected, selected, selected])
    with Checkpoint(tmp_path/'run', settings, resume=True) as cp:
        writers = writing_team(llm, settings, names=cp.writer_names, definitions=cp.personas)
        result = scout_team(cp.wrap(llm), settings, writers, cp.read('research')['stories'], cp)
        assert cp.read('scout_plan') == original_plan
        assert len(result['writer.alpha']) == (1 if saved['theme'] is None else 2)
        assert len(result['writer.beta']) == 2
        assert len(llm.calls) == 3
        assert 'Scout as alpha.' in llm.calls[0]['system']
        # Even without the raw response cache, completed batches need no model calls.
        replay = scout_team(FakeLLM([]), settings, writers, cp.read('research')['stories'], cp)
        assert replay == result
        def no_fetch(_):
            pytest.fail('resume must preserve the original sampled pool')
        drafts = FakeLLM([{'cards': []}] * sum(len(ts) for ts in result.values()))
        summary, _ = Pipeline(settings, drafts, FakeContentClient(), fetch_fn=no_fetch,
                              checkpoint=cp).run(dry_run=True)
        assert summary.themes == sum(len(ts) for ts in result.values())
        assert len(drafts.calls) == summary.themes


def test_retry_is_local_and_feedback_bounded(settings, tmp_path):
    configure(settings, tmp_path)
    llm = FakeLLM([selected, {'theme': {'story_id': 'bad' * 10000}}, selected])
    writer = writing_team(llm, settings)[0]
    result = scout_batches(llm, settings, writer, make_batches(pool(), 0, 6, 2))
    assert len(result) == 2 and len(llm.calls) == 3
    requests = [json.loads(call['user']) for call in llm.calls]
    assert requests[0]['stories'] != requests[1]['stories']
    assert requests[1]['stories'] == requests[2]['stories']
    assert len(requests[2]['repair']) <= 300
    assert 'Voice alpha.' in llm.calls[0]['system']
    assert 'Scout as alpha.' in llm.calls[0]['system']
    assert 'Voice alpha.' not in llm.calls[0]['user']


def test_retry_exhaustion_and_null_do_not_expand_search(settings, tmp_path):
    configure(settings, tmp_path)
    llm = FakeLLM([{}, {}])
    writer = writing_team(llm, settings)[0]
    with pytest.raises(ValueError, match='batch 0'):
        scout_batches(llm, settings, writer, [pool(1)])
    assert len(llm.calls) == 2
    nulls = FakeLLM([{'theme': None}, {'theme': None}])
    assert scout_batches(nulls, settings, writer, make_batches(pool(), 0, 6, 2)) == []
    assert len(nulls.calls) == 2
    assert scout_batches(FakeLLM([]), settings, writer, []) == []


@pytest.mark.parametrize('comedy', [False, True])
def test_pipeline_writers_only_receive_own_selections(settings, tmp_path, comedy):
    configure(settings, tmp_path)
    settings.comedy_loop = comedy
    llm = FakeLLM([selected, selected, {'cards': []}, {'cards': []}])
    summary, batch = Pipeline(settings, llm, FakeContentClient(), fetch_fn=lambda _: feed()).run(dry_run=True)
    assert summary.themes == 2
    assert batch.cards == []
    assert 'Alpha angle' in llm.calls[2]['user'] and 'Beta angle' not in llm.calls[2]['user']
    assert 'Beta angle' in llm.calls[3]['user'] and 'Alpha angle' not in llm.calls[3]['user']


def test_batch_size_is_frozen_for_new_checkpoints(settings, tmp_path):
    with Checkpoint(tmp_path, settings) as cp:
        assert cp.scout_protocol == 'batches-v1'
        assert settings.scout_batch_size == 6
    settings.scout_batch_size = 3
    with pytest.raises(ValueError, match='same model'):
        with Checkpoint(tmp_path, settings, resume=True):
            pass


def test_writer_smoke_uses_small_batches(settings, tmp_path, monkeypatch):
    from scripts import live_smoke
    configure(settings, tmp_path)
    settings.scout_batch_size = 1
    llm = FakeLLM([selected, selected, {'cards': []}, {'cards': []}])
    monkeypatch.setattr(live_smoke, 'load_settings', lambda **_: settings)
    monkeypatch.setattr(live_smoke, 'LLMClient', lambda _: llm)
    monkeypatch.setattr('sys.argv', ['live_smoke.py', '--writers-only'])
    assert live_smoke.main() == 1  # intentionally empty writer drafts
    assert all(len(json.loads(call['user'])['stories']) == 1 for call in llm.calls[:2])
    assert 'Alpha angle' in llm.calls[2]['user']


def test_six_personas_two_batches_have_twelve_calls_and_twenty_four_card_budget(settings):
    settings.writers_per_run = 6
    settings.cards_per_theme = 12
    settings.themes_per_run = 2
    llm = FakeLLM([selected] * 12)
    writers = writing_team(llm, settings)
    result = scout_team(llm, settings, writers, pool())
    assert len(llm.calls) == 12
    assert sum(writer.card_limit * len(result[writer.name]) for writer in writers) == 24
    assert scout_team(FakeLLM([]), settings, writers, []) == {writer.name: [] for writer in writers}
