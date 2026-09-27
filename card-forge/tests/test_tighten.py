import pytest

from forge.tighten import tighten_cards, too_long
from forge.models import CardCandidate
from forge.limits import ANSWER_MAX_WORDS, ANSWER_MAX_CHARS
from conftest import FakeLLM


def test_one_shortening_call_preserves_joke_metadata_and_short_cards():
    long = CardCandidate(kind='answer', text='An unnecessarily elaborate explanation. ' * 10, writer='writer.hatemonger', generation_route='paired_revision')
    short = CardCandidate(kind='answer', text='Urethra Franklin', generation_route='source_find', source_url='https://b3ta.com/questions/x/post1')
    llm = FakeLLM([{'cards': [{'index': 0, 'kind': 'answer', 'text': 'Fucking thermostat police.'}]}])
    result = tighten_cards(llm, [long, short])
    assert len(llm.calls) == 1
    assert result[0].writer == long.writer
    assert result[0].generation_route == 'paired_revision'
    assert not too_long(result[0])
    assert result[1] is short


def test_no_call_for_short_cards_and_drop_failed_shortening():
    short = CardCandidate(kind='prompt', text='The new rule prohibits ____.')
    assert tighten_cards(FakeLLM([]), [short]) == [short]
    long = CardCandidate(kind='answer', text='Very ' * 38 + 'long')
    assert tighten_cards(FakeLLM([{'cards': [{'index': 0, 'kind': 'answer', 'text': long.text}]}]), [long]) == []


def test_shortening_does_not_change_kind_or_rewrite_found_quote():
    long = CardCandidate(kind='prompt', text='Really ' * 30 + '____.')
    assert tighten_cards(FakeLLM([{'cards': [{'index': 0, 'kind': 'answer', 'text': 'Different kind'}]}]), [long]) == []
    quote = CardCandidate(kind='answer', text='Long ' * 38, generation_route='source_find')
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


@pytest.mark.parametrize('kind, short, long', [
    ('prompt', 'The new policy requires ____.', 'Long ' * 20 + '____.'),
    ('answer', 'The thermostat police.', 'word ' * 38),
])
def test_shortening_uses_each_authors_voice_and_rejects_cross_author_indexes(settings, kind, short, long):
    from forge.personas.writer import DeadpanWriter, UnhingedWriter

    llm = FakeLLM([
        {'cards': [
            {'index': 0, 'kind': kind, 'text': short},
            {'index': 1, 'kind': kind, 'text': short},
        ]},
        {'cards': [{'index': 1, 'kind': kind, 'text': long}]},
    ])
    writers = [DeadpanWriter(llm, settings), UnhingedWriter(llm, settings)]
    cards = [CardCandidate(kind=kind, text=long,
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
        assert f'{ANSWER_MAX_WORDS} non-filler words' in call['system']
        assert 'current_characters' in call['user']


@pytest.mark.parametrize('text, valid', [
    ('Chaos.', True),
    ('Existential dread.', True),
    ('The thermostat police.', True),
    ('The\tthermostat\npolice.', True),
    ('The federal thermostat police.', True),
    ("Michelle Obama's mysterious dancing bulge", True),
    ('A federal investigation into thermostat tampering.', True),
    (' '.join(['cat'] * ANSWER_MAX_WORDS), True),
    (' '.join(['cat'] * (ANSWER_MAX_WORDS + 1)), False),
    ('the ' + ' '.join(['cat'] * ANSWER_MAX_WORDS), True),
    ('é' * ANSWER_MAX_CHARS, True),
    ('é' * (ANSWER_MAX_CHARS + 1), False),
])
def test_answer_length_and_submission_guard(text, valid):
    from forge.models import SubmitCard

    card = CardCandidate(kind='answer', text=text)
    assert too_long(card) is not valid
    fields = dict(kind='answer', text=text, blanks=0, maturity_rating=1, pack='test')
    if valid:
        assert SubmitCard(**fields).text == text
    else:
        with pytest.raises(ValueError, match='answer must be at most'):
            SubmitCard(**fields)


@pytest.mark.parametrize('text, expected', [
    ('A raccoon in a trench coat.', 3),
    ('THE, raccoon AND a goose.', 2),
    ('Not my problem.', 3),
    ("Michelle Obama's mysterious dancing bulge", 5),
    ('Rock-and-roll with fries.', 2),
    ('a an the and or but of to in on at by for with from as', 0),
])
def test_answer_word_count_excludes_only_fixed_fillers(text, expected):
    from forge.limits import count_answer_words
    assert count_answer_words(text) == expected


def test_answer_fillers_do_not_trigger_rewrite():
    card = CardCandidate(kind='answer', text='the ' + ' '.join(['cat'] * ANSWER_MAX_WORDS))
    assert tighten_cards(FakeLLM([]), [card]) == [card]
