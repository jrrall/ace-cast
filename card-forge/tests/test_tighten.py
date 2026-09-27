from forge.tighten import tighten_cards, too_long
from forge.models import CardCandidate
from conftest import FakeLLM


def test_one_shortening_call_preserves_joke_metadata_and_short_cards():
    long = CardCandidate(kind='answer', text='An unnecessarily elaborate explanation of an emergency investigation into who touched the thermostat at dinner.', writer='writer.hatemonger', generation_route='paired_revision')
    short = CardCandidate(kind='answer', text='Urethra Franklin', generation_route='source_find', source_url='https://b3ta.com/questions/x/post1')
    llm = FakeLLM([{'cards': [{'index': 0, 'kind': 'answer', 'text': 'A federal investigation into who touched the fucking thermostat.'}]}])
    result = tighten_cards(llm, [long, short])
    assert len(llm.calls) == 1
    assert result[0].writer == long.writer
    assert result[0].generation_route == 'paired_revision'
    assert not too_long(result[0])
    assert result[1] is short


def test_no_call_for_short_cards_and_drop_failed_shortening():
    short = CardCandidate(kind='prompt', text='The new rule prohibits ____.')
    assert tighten_cards(FakeLLM([]), [short]) == [short]
    long = CardCandidate(kind='answer', text='Very ' * 30 + 'long')
    assert tighten_cards(FakeLLM([{'cards': [{'index': 0, 'kind': 'answer', 'text': long.text}]}]), [long]) == []


def test_shortening_does_not_change_kind_or_rewrite_found_quote():
    long = CardCandidate(kind='prompt', text='Really ' * 30 + '____.')
    assert tighten_cards(FakeLLM([{'cards': [{'index': 0, 'kind': 'answer', 'text': 'Different kind'}]}]), [long]) == []
    quote = CardCandidate(kind='answer', text='Long ' * 30, generation_route='source_find')
    assert tighten_cards(FakeLLM([]), [quote]) == []


def test_prompt_character_boundary_and_submission_guard():
    import pytest
    from forge.models import SubmitCard
    from forge.limits import PROMPT_MAX_CHARS

    exact = 'é' * (PROMPT_MAX_CHARS - 4) + '____'
    assert not too_long(CardCandidate(kind='prompt', text=exact))
    assert too_long(CardCandidate(kind='prompt', text=exact + '.'))
    fields = dict(kind='prompt', blanks=1, maturity_rating=1, pack='test')
    assert SubmitCard(text=exact, **fields).text == exact
    with pytest.raises(ValueError, match='at most 54 characters'):
        SubmitCard(text=exact + '.', **fields)


def test_shortening_uses_each_authors_voice_and_rejects_cross_author_indexes(settings):
    from forge.personas.writer import DeadpanWriter, UnhingedWriter

    llm = FakeLLM([
        {'cards': [
            {'index': 0, 'kind': 'prompt', 'text': 'The new policy requires ____.'},
            {'index': 1, 'kind': 'prompt', 'text': 'Do not accept this ____.'},
        ]},
        {'cards': [{'index': 1, 'kind': 'prompt', 'text': 'Long ' * 20 + '____.'}]},
    ])
    writers = [DeadpanWriter(llm, settings), UnhingedWriter(llm, settings)]
    cards = [CardCandidate(kind='prompt', text='Long ' * 20 + '____.',
                           writer=w.name, generation_route='paired_revision',
                           source_url='https://example.com/research') for w in writers]
    result = tighten_cards(llm, cards, writers=writers)
    assert len(result) == 1
    assert result[0].writer == writers[0].name
    assert result[0].generation_route == 'paired_revision'
    assert result[0].source_url == cards[0].source_url
    for call, writer in zip(llm.calls, writers):
        assert writer.voice in call['system']
        assert writer.definition.phases['revise'] in call['system']
        assert '54 characters' in call['system']
        assert 'current_characters' in call['user']
