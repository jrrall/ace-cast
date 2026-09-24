import json
import pytest
from forge.comedy_room import ComedyRoom, _indexed, PARTNERS
from forge.models import Theme
from conftest import FakeLLM


def responses(revision=None):
    drafts = [{'cards': [{'kind': 'answer', 'text': f'Original idea {i}'}]} for i in range(6)]
    for i in range(6):
        drafts += [{'challenges': [{'index': 0, 'kind': 'answer', 'text': f'Partner idea {i}', 'critique': 'Make the consequence specific'}]},
                   {'revisions': revision if revision is not None else [{'index': 0, 'kind': 'answer', 'text': f'Revised idea {i}', 'writer': 'spoofed'}]}]
    return drafts


def test_one_exchange_blind_drafts_attribution_and_trace(settings, tmp_path):
    settings.cards_per_theme = 12
    settings.comedy_trace_path = str(tmp_path/'run.jsonl')
    events = []
    llm = FakeLLM(responses())
    final = ComedyRoom(llm, settings, emit=events.append).run([Theme(title='Family rule')])
    assert len(llm.calls) == 18
    assert all('Original idea' not in call['user'] for call in llm.calls[:6])
    assert [e['stage'] for e in events[:6]] == ['draft'] * 6
    assert len(final) == 6
    revisions = [e for e in events if e['stage'] == 'revision']
    for i, (event, card) in enumerate(zip(revisions, final)):
        assert event['challenger'] == PARTNERS[card.writer]
        assert event['original']['text'] == f'Original idea {i}'
        assert event['revision']['text'] == f'Revised idea {i}'
        assert event['revision']['writer'] == card.writer
        assert event['changed']
    assert [json.loads(line) for line in (tmp_path/'run.jsonl').read_text().splitlines()] == events
    assert len({e['run_id'] for e in events}) == 1


@pytest.mark.parametrize('revision', [[], [{'index': True, 'kind': 'answer', 'text': 'Invalid index'}],
    [{'index': 0, 'kind': 'prompt', 'text': 'Changed kind ____'}],
    [{'index': 0, 'kind': 'answer', 'text': 'bad ____'}],
    [{'index': 0, 'kind': 'answer', 'text': 'First'}, {'index': 0, 'kind': 'answer', 'text': 'Duplicate'}]])
def test_invalid_or_declined_revision_keeps_original(settings, revision):
    settings.cards_per_theme = 12
    cards = ComedyRoom(FakeLLM(responses(revision)), settings, emit=lambda e: None).run([Theme(title='Rule')])
    assert [c.text for c in cards] == [f'Original idea {i}' for i in range(6)]


def test_failed_challenge_preserves_written_drafts(settings, tmp_path):
    settings.cards_per_theme = 12
    settings.comedy_trace_path = str(tmp_path/'run.jsonl')
    llm = FakeLLM(responses()[:6] + [{'not_challenges': []}])
    with pytest.raises(ValueError, match='challenges list'):
        ComedyRoom(llm, settings, emit=lambda e: None).run([Theme(title='Rule')])
    assert len((tmp_path/'run.jsonl').read_text().splitlines()) == 6


def test_duplicate_and_out_of_range_indexes_are_rejected():
    assert _indexed({'rows': [{'index': -1}, {'index': 4}, {'index': False}, {'index': 0}, {'index': 0}]}, 'rows', 2) == {}


def test_pipeline_loop_flows_through_review_without_submission(settings, monkeypatch):
    from forge.pipeline import Pipeline
    from forge.personas import Trendscout
    from conftest import FakeContentClient, rated_selection
    settings.cards_per_theme = 12
    settings.comedy_loop = True
    monkeypatch.setattr(Trendscout, 'run', lambda self: [Theme(title='Rule')])
    cards = [{'source_index': i, 'kind': 'answer', 'text': f'Revised idea {i}'} for i in range(6)]
    llm = FakeLLM(responses() + [{'cards': cards},
        {'verdicts': [{'index': i, 'allowed': True, 'maturity_rating': 2} for i in range(6)]},
        rated_selection(list(range(6)))])
    content = FakeContentClient()
    summary, batch = Pipeline(settings, llm, content).run(dry_run=True)
    assert summary.generated == 6
    assert len(batch.cards) == 6
    assert len({c.writer for c in batch.cards}) == 6
    assert all(c.text.startswith('Revised idea') for c in batch.cards)
    assert content.submitted == []
