"""All enabled voices must independently read the same research and reach review."""
import pytest
from pydantic import ValidationError
from forge.config import Settings
from forge.models import Theme
from forge.personas.writer import writing_team
from forge.pipeline import Pipeline
from conftest import BUILTIN_PERSONAS, WRITER_COUNT, rated_selection, FakeLLM, FakeContentClient


def test_all_voices_share_research_and_split_budget(settings):
    settings.cards_per_theme = WRITER_COUNT
    theme = Theme(title='Sponsored apologies', angle='Remorse as ad inventory')
    llm = FakeLLM([{'cards': [*({'kind': 'prompt', 'text': f'{voice} {i}: ____.'} for i in range(6)), *({'kind': 'answer', 'text': f'{voice} {i}'} for i in range(6))]}
                   for voice in [p.id for p in BUILTIN_PERSONAS]])
    writers = writing_team(llm, settings)
    results = [w.run(theme) for w in writers]
    assert [len(cards) for cards in results] == [1] * WRITER_COUNT
    for index, voice in enumerate(p.name for p in BUILTIN_PERSONAS):
        assert f'You are the {voice} Writer' in llm.calls[index]['system']
    for call in llm.calls:
        assert 'Sponsored apologies' in call['user']
        assert 'Remorse as ad inventory' in call['user']
        assert 'exactly one' in call['system']
        assert 'deadpan 0' not in call['user']  # no other writer's drafts


def test_pipeline_reviews_cards_from_all_writers(settings):
    settings.curator_batch_size = WRITER_COUNT
    settings.moderator_batch_size = WRITER_COUNT
    settings.batch_max = 2 * WRITER_COUNT
    settings.cards_per_theme = 2 * WRITER_COUNT
    settings.editor_batch_size = WRITER_COUNT
    drafts = [{'kind': 'answer', 'text': f'A ceremonial permit number {i}.'}
              for i in range(WRITER_COUNT)]
    llm = FakeLLM([
        {'themes': [{'title': 'Trust badges'}]},
        *[{'cards': [card]} for card in drafts],
        {'cards': drafts},
        {'verdicts': [{'index': i, 'allowed': True, 'maturity_rating': 1} for i in range(WRITER_COUNT)]},
        rated_selection(list(range(WRITER_COUNT))),
    ])
    content = FakeContentClient()
    summary, batch = Pipeline(settings, llm, content, fetch_fn=lambda _: []).run(dry_run=True)
    assert len({call['user'] for call in llm.calls[1:1 + WRITER_COUNT]}) == 1
    for card in drafts:
        assert card['text'] in llm.calls[1 + WRITER_COUNT]['user']
    assert summary.generated == WRITER_COUNT
    assert len(batch.cards) == WRITER_COUNT
    assert batch.cards[-1].writer == BUILTIN_PERSONAS[-1].writer_name
    assert content.submitted == []


def test_budget_requires_a_card_for_each_writer():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, cards_per_theme=5)


@pytest.mark.parametrize("total", [WRITER_COUNT, WRITER_COUNT + 1, WRITER_COUNT + 5, 2 * WRITER_COUNT, 3 * WRITER_COUNT + 1])
def test_team_reserves_half_the_slots_for_each_type(settings, total):
    settings.cards_per_theme = total
    writers = writing_team(FakeLLM([]), settings)
    assert sum(w.card_limit for w in writers) == total
    assert sum(w.prompt_limit for w in writers) == total // 2
    assert all(0 <= w.prompt_limit <= w.card_limit for w in writers)


def test_new_roster_requires_full_budget_but_legacy_six_can_resume(settings):
    from forge.personas.writer import WRITER_TYPES
    settings.cards_per_theme = 6
    with pytest.raises(ValueError, match=f'at least {WRITER_COUNT}'):
        writing_team(FakeLLM([]), settings)
    legacy = [w.name for w in WRITER_TYPES if w.name != 'writer.toxic_positivity']
    writers = writing_team(FakeLLM([]), settings, names=legacy)
    assert len(writers) == 6
    assert all(w.card_limit == 1 for w in writers)


def test_defaults_sample_eight_writers_with_one_prompt_and_answer_each(monkeypatch):
    for key in ('WRITERS_PER_RUN', 'CARDS_PER_THEME', 'PERSONAS_DIR'):
        monkeypatch.delenv(key, raising=False)
    settings = Settings(_env_file=None)
    draws = []
    def sample(population, count):
        draws.append((list(population), count))
        return list(population)[-count:]
    monkeypatch.setattr('forge.persona_registry.random.sample', sample)
    writers = writing_team(FakeLLM([]), settings)
    assert draws == [(list(range(WRITER_COUNT)), 8)]
    assert [w.name for w in writers] == [p.writer_name for p in BUILTIN_PERSONAS[-8:]]
    assert settings.cards_per_theme == 16
    assert all(w.card_limit == 2 and w.prompt_limit == 1 for w in writers)
