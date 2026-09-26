import json
import pytest
from forge.comedy_room import ComedyRoom, _indexed
from forge.models import CardCandidate, Theme
from forge.persona_registry import load_personas
from conftest import FakeLLM


class RoundWriter:
    def __init__(self, name):
        self.name = name

    def run(self, theme, *, batch):
        return [CardCandidate(kind='answer', text=f'{self.name} {theme.title}', writer=self.name)]

    def phase_system(self, phase, *, format_rules):
        return f'{format_rules} {self.name} {phase}'


def test_challengers_are_drawn_from_each_round_without_self_challenges(settings, monkeypatch):
    pools = []
    def choose(names):
        pools.append(names)
        return names[-1]
    monkeypatch.setattr('forge.comedy_room.random.choice', choose)
    writers = [RoundWriter(name) for name in ('positive', 'bitch', 'spin')]
    themes = {'positive': [Theme(title=str(i)) for i in range(3)],
              'bitch': [Theme(title='0')],
              'spin': [Theme(title=str(i)) for i in range(2)]}
    events = []
    llm = FakeLLM([{'challenges': []}] * 5)
    final = ComedyRoom(llm, settings, writers=writers, emit=events.append).run(themes)
    assert pools == [['bitch', 'spin'], ['positive', 'spin'], ['positive', 'bitch'],
                     ['spin'], ['positive']]
    assert len(final) == 6  # the solo final round keeps its original without a critique
    assert len(llm.calls) == 5
    assert [(e['writer'], e['challenger']) for e in events if e['stage'] == 'challenge'] == [
        ('positive', 'spin'), ('bitch', 'spin'), ('spin', 'bitch'),
        ('positive', 'spin'), ('spin', 'positive')]


def test_resume_reuses_challenger_draw_after_interrupted_critique(settings, tmp_path, monkeypatch):
    from forge.checkpoint import Checkpoint
    writers = [RoundWriter(name) for name in ('positive', 'bitch', 'spin')]
    def interrupted(_):
        raise RuntimeError('interrupted')
    with Checkpoint(tmp_path/'run', settings) as cp:
        room = ComedyRoom(cp.wrap(FakeLLM([interrupted])), settings, writers=writers,
                          checkpoint=cp, emit=lambda _: None)
        with pytest.raises(RuntimeError, match='interrupted'):
            room.run([Theme(title='Party')])
        saved = cp.read('comedy_challengers/0')['challengers']
    monkeypatch.setattr('forge.comedy_room.random.choice', lambda _: pytest.fail('must reuse saved draw'))
    events = []
    with Checkpoint(tmp_path/'run', settings, resume=True) as cp:
        llm = FakeLLM([{'challenges': []}] * 3)
        final = ComedyRoom(cp.wrap(llm), settings, writers=writers, checkpoint=cp,
                           emit=events.append).run([Theme(title='Party')])
    assert len(final) == 3
    assert {e['writer']: e['challenger'] for e in events if e['stage'] == 'challenge'} == saved


def responses(revision=None):
    drafts = [{'cards': [{'kind': 'answer', 'text': f'Original idea {i}'}]} for i in range(9)]
    for i in range(9):
        drafts += [{'challenges': [{'index': 0, 'kind': 'answer', 'text': f'Partner idea {i}', 'critique': 'Make the consequence specific'}]},
                   {'revisions': revision if revision is not None else [{'index': 0, 'kind': 'answer', 'text': f'Revised idea {i}', 'writer': 'spoofed'}]}]
    return drafts


def test_one_exchange_blind_drafts_attribution_and_trace(settings, tmp_path):
    settings.cards_per_theme = 18
    settings.comedy_trace_path = str(tmp_path/'run.jsonl')
    events = []
    llm = FakeLLM(responses())
    final = ComedyRoom(llm, settings, emit=events.append).run([Theme(title='Family rule')])
    assert len(llm.calls) == 27
    assert all('Original idea' not in call['user'] for call in llm.calls[:9])
    assert [e['stage'] for e in events[:9]] == ['draft'] * 9
    assert len(final) == 18
    assert all(c.generation_route == "writer" for c in final[::2])
    assert all(c.generation_route == "paired_revision" for c in final[1::2])
    revisions = [e for e in events if e['stage'] == 'revision']
    profiles = {p.writer_name: p for p in load_personas()}
    for i, (event, card) in enumerate(zip(revisions, final[1::2])):
        assert event['challenger'] != card.writer
        assert event['challenger'] in {c.writer for c in final}
        assert profiles[event['challenger']].voice in llm.calls[9 + 2*i]['system']
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
    settings.cards_per_theme = 18
    cards = ComedyRoom(FakeLLM(responses(revision)), settings, emit=lambda e: None).run([Theme(title='Rule')])
    assert [c.text for c in cards] == [f'Original idea {i}' for i in range(9)]


def test_failed_challenge_preserves_written_drafts(settings, tmp_path):
    settings.cards_per_theme = 18
    settings.comedy_trace_path = str(tmp_path/'run.jsonl')
    llm = FakeLLM(responses()[:9] + [{'not_challenges': []}])
    with pytest.raises(ValueError, match='challenges list'):
        ComedyRoom(llm, settings, emit=lambda e: None).run([Theme(title='Rule')])
    assert len((tmp_path/'run.jsonl').read_text().splitlines()) == 9


def test_duplicate_and_out_of_range_indexes_are_rejected():
    assert _indexed({'rows': [{'index': -1}, {'index': 4}, {'index': False}, {'index': 0}, {'index': 0}]}, 'rows', 2) == {}


def test_pipeline_loop_flows_through_review_without_submission(settings, monkeypatch):
    settings.curator_batch_size = 9
    from forge.pipeline import Pipeline
    from forge.personas import Trendscout
    from conftest import FakeContentClient, rated_selection
    settings.cards_per_theme = 18
    settings.comedy_loop = True
    settings.editor_batch_size = 18
    monkeypatch.setattr(Trendscout, 'run', lambda self: [Theme(title='Rule')])
    cards = [{'source_index': 2*i+1, 'kind': 'answer', 'text': f'Revised idea {i}'} for i in range(9)]
    llm = FakeLLM(responses() + [{'cards': cards},
        {'verdicts': [{'index': i, 'allowed': True, 'maturity_rating': 2} for i in range(9)]},
        rated_selection(list(range(9)))])
    content = FakeContentClient()
    summary, batch = Pipeline(settings, llm, content).run(dry_run=True)
    assert summary.generated == 18
    assert len(batch.cards) == 9
    assert len({c.writer for c in batch.cards}) == 9
    assert all(c.text.startswith('Revised idea') for c in batch.cards)
    assert content.submitted == []
