import json

import pytest

from conftest import FakeLLM
from forge.checkpoint import Checkpoint
from forge.logging_setup import get_logger
from forge.personas.trendscout import Trendscout
from forge.personas.writer import writing_team
from forge.scout_batches import scout_batches
from forge.scout_comparison import Recorder, compare, summarize
from forge.stories import stories_from_items
from test_persona_scout import configure, feed


@pytest.fixture
def events(tmp_path):
    recorder = Recorder(tmp_path/'events.jsonl')
    recorder.context = {'arm': 'batches'}
    get_logger().addHandler(recorder)
    yield recorder.events
    get_logger().removeHandler(recorder)


def test_attempt_logs_validation_null_cache_and_checkpoint_separately(settings, tmp_path, events):
    configure(settings, tmp_path)
    stories = stories_from_items(feed())
    llm = FakeLLM([{}, {'theme': None}])
    writer = writing_team(llm, settings)[0]
    with Checkpoint(tmp_path/'run', settings) as cp:
        wrapped = cp.wrap(llm)
        assert scout_batches(wrapped, settings, writer, [stories], cp) == []
        assert [e['attempt'] for e in events] == [1, 2]
        assert events[0]['validation_failed'] and events[0]['selected'] is None
        assert events[1]['selected'] is False
        assert all(e['source'] == 'generation' and e['model_attempts'] == 1 for e in events)
        assert all(e['input_chars'] > e['user_chars'] > 0 and e['duration_s'] >= 0 for e in events)
        assert all(e['persona'] == writer.name and e['story_count'] == 2 for e in events)
        # Raw call replay still validates; it is not generation time.
        scout_batches(wrapped, settings, writer, [stories])
        assert events[-1]['source'] == 'cache' and events[-1]['model_attempts'] == 0
        scout_batches(wrapped, settings, writer, [stories], cp)
        assert events[-1]['source'] == 'checkpoint' and events[-1]['attempt'] == 0
        assert events[-1]['input_chars'] == 0
        assert len(llm.calls) == 2


def test_model_failure_and_baseline_are_observed(settings, tmp_path, events):
    from forge.llm import LLMError
    configure(settings, tmp_path)
    def fail(_):
        raise LLMError('timeout')
    llm = FakeLLM([fail])
    writer = writing_team(llm, settings)[0]
    with pytest.raises(LLMError):
        Trendscout(llm, settings).for_stories(writer, stories_from_items(feed()))
    assert events[0]['protocol'] == 'stories-v1'
    assert events[0]['error_type'] == 'LLMError'
    assert not events[0]['validation_failed']
    assert events[0]['selected'] is None


def source_run(settings, tmp_path):
    configure(settings, tmp_path)
    source = tmp_path/'source'
    with Checkpoint(source, settings) as cp:
        cp.write('research', {'stories': stories_from_items(feed())})
    return source


def response(call):
    if call['user'].startswith('{'):
        payload = json.loads(call['user'])
        theme = {'story_id': payload['stories'][0]['id'], 'title': 'Title', 'angle': 'Angle'}
        return {'theme': theme} if 'Return only {"theme":' in call['system'] else {'themes': [theme]}
    return {'cards': [{'kind': 'answer', 'text': 'A municipal grudge.'}]}


def test_comparison_freezes_inputs_uses_fresh_calls_and_keeps_cards_local(settings, tmp_path):
    source = source_run(settings, tmp_path)
    llm = FakeLLM([response] * 8)
    original = (source/'manifest.json').read_bytes()
    output = tmp_path/'comparison'
    report = compare(source, output, settings, factory=lambda _: llm)
    assert report['status'] == 'complete'
    assert len(llm.calls) == 8  # four scouts + four independent writer calls
    assert (source/'manifest.json').read_bytes() == original
    saved = json.loads((output/'inputs.json').read_text())
    assert saved['stories'] == stories_from_items(feed())
    assert saved['compared_personas'] == ['writer.alpha', 'writer.beta']
    assert len(saved['personas']) == 2
    assert 'test-key' not in (output/'inputs.json').read_text()
    assert 'test-token' not in (output/'inputs.json').read_text()
    for arm in report['results'].values():
        assert arm['selected_themes'] == 2 and arm['cards'] == 2
        assert arm['distinct_stories'] == 1
        assert arm['cache_reuses'] == arm['checkpoint_reuses'] == 0
    assert (output/'outcomes.json').exists() and (output/'calls.jsonl').exists()
    with pytest.raises(FileExistsError):
        compare(source, output, settings, factory=lambda _: pytest.fail('must not call'))


def test_budget_saves_partial_report_without_calling_again(settings, tmp_path):
    source = source_run(settings, tmp_path)
    llm = FakeLLM([response])
    output = tmp_path/'limited'
    report = compare(source, output, settings, max_calls=1, factory=lambda _: llm)
    assert report['status'] == 'budget_exhausted'
    assert len(llm.calls) == 1
    assert json.loads((output/'outcomes.json').read_text())[-1]['status'] == 'budget_exhausted'
    assert report['results']['full_pool']['selected_themes'] == 1
    assert report['results']['batches']['scout_model_attempts'] == 0


def test_summary_excludes_reuse_from_generation_times():
    base = dict(arm='batches', duration_s=100, input_chars=200, attempt=2, model_attempts=0,
                format_retries=0, validation_failed=False)
    events = [{**base, 'source': 'cache'}, {**base, 'source': 'checkpoint'},
              {**base, 'source': 'generation', 'duration_s': 3, 'model_attempts': 1}]
    summary = summarize(events, [], [])['batches']
    assert summary['scout_generation_s'] == 3 and summary['scout_observed_s'] == 203
    assert summary['cache_reuses'] == summary['checkpoint_reuses'] == 1
    assert summary['request_chars']['total'] == 200
    assert summary['schema_retries'] == 1


def test_failure_keeps_evidence_and_continues_other_route(settings, tmp_path):
    from forge.llm import LLMError
    source = source_run(settings, tmp_path)
    def fail(_):
        raise LLMError('timeout')
    llm = FakeLLM([fail, response, response])
    output = tmp_path/'failed-baseline'
    report = compare(source, output, settings, persona_count=1, factory=lambda _: llm)
    assert report['results']['full_pool']['failed_scout_units'] == 1
    assert report['results']['batches']['selected_themes'] == 1
    assert report['results']['batches']['cards'] == 1
    calls = [json.loads(line) for line in (output/'calls.jsonl').read_text().splitlines()]
    assert calls[1]['event'] == 'finished' and calls[1]['error_type'] == 'LLMError'


def test_wall_budget_prevents_a_new_call_and_caps_timeout(settings, tmp_path, monkeypatch):
    from forge.scout_comparison import BudgetExceeded, FreshCalls
    elapsed = [100.0]
    monkeypatch.setattr('forge.scout_comparison.time.monotonic', lambda: elapsed[0])
    observed = []
    def factory(config):
        observed.append(config)
        return FakeLLM([{'theme': None}])
    llm = FreshCalls(settings, tmp_path, max_calls=5, max_seconds=10, factory=factory)
    llm.complete_json(system='system', user='{}')
    assert observed[0].llm_timeout == 5  # two possible format attempts share the remaining time
    assert observed[0].llm_max_retries == 0
    elapsed[0] = 111.0
    with pytest.raises(BudgetExceeded):
        llm.complete_json(system='system', user='{}')
    assert len(observed) == 1
    assert llm.last_call_source == 'budget'


def test_full_pool_checkpoint_reuse_reports_theme_count(settings, tmp_path, events):
    from forge.models import Theme
    from forge.scout_metrics import scout_reused
    configure(settings, tmp_path)
    writer = writing_team(FakeLLM([]), settings)[0]
    scout_reused(writer, 0, feed(), [Theme(title='First'), Theme(title='Second')], protocol='stories-v1')
    assert events[-1]['selected_count'] == 2 and events[-1]['source'] == 'checkpoint'
    assert events[-1]['protocol'] == 'stories-v1'


def test_interrupt_preserves_partial_artifacts(settings, tmp_path):
    source = source_run(settings, tmp_path)
    def interrupt(_):
        raise KeyboardInterrupt()
    output = tmp_path/'interrupted'
    with pytest.raises(KeyboardInterrupt):
        compare(source, output, settings, factory=lambda _: FakeLLM([interrupt]))
    assert json.loads((output/'summary.json').read_text())['status'] == 'interrupted'
    assert json.loads((output/'outcomes.json').read_text())[0]['status'] == 'interrupted'
    assert (output/'report.md').exists()


def test_comparison_accepts_all_nine_saved_personas(settings, tmp_path):
    settings.themes_per_run = 1
    source = tmp_path/'source'
    with Checkpoint(source, settings) as cp:
        assert len(cp.personas) == 9
        cp.write('research', {'stories': stories_from_items(feed())})
    def empty(call):
        return {'theme': None} if 'Return only {"theme":' in call['system'] else {'themes': []}
    llm = FakeLLM([empty] * 18)
    report = compare(source, tmp_path/'all-nine', settings, persona_count=9, factory=lambda _: llm)
    assert report['status'] == 'complete'
    assert len(llm.calls) == 18
    assert len(report['results']['batches']['themes_by_persona']) == 9
