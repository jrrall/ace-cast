import json
import pytest
from forge.comedy_room import ComedyRoom, _indexed, PARTNERS
from forge.models import Theme
from conftest import FakeLLM


def responses(revision=None):
    drafts = [{'cards': [{'kind': 'answer', 'text': f'Original idea {i}'}]} for i in range(8)]
    for i in range(8):
        drafts += [{'challenges': [{'index': 0, 'kind': 'answer', 'text': f'Partner idea {i}', 'critique': 'Make the consequence specific'}]},
                   {'revisions': revision if revision is not None else [{'index': 0, 'kind': 'answer', 'text': f'Revised idea {i}', 'writer': 'spoofed'}]}]
    return drafts


def test_one_exchange_blind_drafts_attribution_and_trace(settings, tmp_path):
    settings.cards_per_theme = 16
    settings.comedy_trace_path = str(tmp_path/'run.jsonl')
    events = []
    llm = FakeLLM(responses())
    final = ComedyRoom(llm, settings, emit=events.append).run([Theme(title='Family rule')])
    assert len(llm.calls) == 24
    assert all('Original idea' not in call['user'] for call in llm.calls[:8])
    assert [e['stage'] for e in events[:8]] == ['draft'] * 8
    assert len(final) == 16
    assert all(c.generation_route == "writer" for c in final[::2])
    assert all(c.generation_route == "paired_revision" for c in final[1::2])
    revisions = [e for e in events if e['stage'] == 'revision']
    for i, (event, card) in enumerate(zip(revisions, final[1::2])):
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
    settings.cards_per_theme = 16
    cards = ComedyRoom(FakeLLM(responses(revision)), settings, emit=lambda e: None).run([Theme(title='Rule')])
    assert [c.text for c in cards] == [f'Original idea {i}' for i in range(8)]


def test_failed_challenge_preserves_written_drafts(settings, tmp_path):
    settings.cards_per_theme = 16
    settings.comedy_trace_path = str(tmp_path/'run.jsonl')
    llm = FakeLLM(responses()[:8] + [{'not_challenges': []}])
    with pytest.raises(ValueError, match='challenges list'):
        ComedyRoom(llm, settings, emit=lambda e: None).run([Theme(title='Rule')])
    assert len((tmp_path/'run.jsonl').read_text().splitlines()) == 8


def test_duplicate_and_out_of_range_indexes_are_rejected():
    assert _indexed({'rows': [{'index': -1}, {'index': 4}, {'index': False}, {'index': 0}, {'index': 0}]}, 'rows', 2) == {}


def test_pipeline_loop_flows_through_review_without_submission(settings, monkeypatch):
    from forge.pipeline import Pipeline
    from forge.personas import Trendscout
    from conftest import FakeContentClient, rated_selection
    settings.cards_per_theme = 16
    settings.comedy_loop = True
    settings.editor_batch_size = 16
    monkeypatch.setattr(Trendscout, 'run', lambda self: [Theme(title='Rule')])
    cards = [{'source_index': 2*i+1, 'kind': 'answer', 'text': f'Revised idea {i}'} for i in range(8)]
    llm = FakeLLM(responses() + [{'cards': cards},
        {'verdicts': [{'index': i, 'allowed': True, 'maturity_rating': 2} for i in range(8)]},
        rated_selection(list(range(8)))])
    content = FakeContentClient()
    summary, batch = Pipeline(settings, llm, content).run(dry_run=True)
    assert summary.generated == 16
    assert len(batch.cards) == 8
    assert len({c.writer for c in batch.cards}) == 8
    assert all(c.text.startswith('Revised idea') for c in batch.cards)
    assert content.submitted == []
