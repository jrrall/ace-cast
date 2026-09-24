"""All five voices must independently read the same research and reach review."""
import pytest
from pydantic import ValidationError
from forge.config import Settings
from forge.models import Theme
from forge.personas.writer import writing_team
from forge.pipeline import Pipeline
from conftest import rated_selection, FakeLLM, FakeContentClient


def test_all_voices_share_research_and_split_budget(settings):
    settings.cards_per_theme = 7
    theme = Theme(title='Sponsored apologies', angle='Remorse as ad inventory')
    llm = FakeLLM([{'cards': [*({'kind': 'prompt', 'text': f'{voice} {i}: ____.'} for i in range(6)), *({'kind': 'answer', 'text': f'{voice} {i}'} for i in range(6))]}
                   for voice in ['dry', 'wild', 'spin', 'petty', 'banned']])
    writers = writing_team(llm, settings)
    results = [w.run(theme) for w in writers]
    assert [len(cards) for cards in results] == [2, 2, 1, 1, 1]
    for index, voice in enumerate(['Deadpan', 'Unhinged', 'PR Spin Doctor', 'Petty Villain', 'Banned From the Thread']):
        assert f'You are the {voice} Writer.' in llm.calls[index]['system']
    for call in llm.calls:
        assert 'Sponsored apologies' in call['user']
        assert 'Remorse as ad inventory' in call['user']
        assert 'exactly one' in call['system']
        assert 'dry 0' not in call['user']  # no other writer's drafts


def test_pipeline_reviews_cards_from_all_writers(settings):
    settings.cards_per_theme = 10
    drafts = [{'kind': 'prompt', 'text': 'The background check only asked about ____.'},
              {'kind': 'answer', 'text': 'A babysitter sponsored by a bail bondsman.'},
              {'kind': 'answer', 'text': 'A premium accountability opt-out.'},
              {'kind': 'answer', 'text': 'An anonymous one-star review of a birthday party.'},
              {'kind': 'answer', 'text': 'A verified expert in losing arguments to parking meters.'}]
    llm = FakeLLM([
        {'themes': [{'title': 'Trust badges'}]},
        *[{'cards': [card]} for card in drafts],
        {'cards': drafts},
        {'verdicts': [{'index': i, 'allowed': True, 'maturity_rating': 1} for i in range(5)]},
        rated_selection([0, 1, 2, 3, 4]),
    ])
    content = FakeContentClient()
    summary, batch = Pipeline(settings, llm, content, fetch_fn=lambda _: []).run(dry_run=True)
    assert len({call['user'] for call in llm.calls[1:6]}) == 1
    for card in drafts:
        assert card['text'] in llm.calls[6]['user']
    assert summary.generated == 5
    assert len(batch.cards) == 5
    assert content.submitted == []


def test_budget_requires_a_card_for_each_writer():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, cards_per_theme=4)


@pytest.mark.parametrize("total", [5, 7, 8, 10, 11, 32])
def test_team_reserves_half_the_slots_for_each_type(settings, total):
    settings.cards_per_theme = total
    writers = writing_team(FakeLLM([]), settings)
    assert sum(w.card_limit for w in writers) == total
    assert sum(w.prompt_limit for w in writers) == total // 2
    assert all(0 <= w.prompt_limit <= w.card_limit for w in writers)
