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
    assert tighten_cards(FakeLLM([{'cards': [{'index': 0, 'kind': 'answer', 'text': long.text}]}] * 2), [long]) == []


def test_shortening_does_not_change_kind_or_rewrite_found_quote():
    long = CardCandidate(kind='answer', text='Really ' * 30 + 'long.')
    assert tighten_cards(FakeLLM([{'cards': [{'index': 0, 'kind': 'prompt', 'text': 'Different ____.'}]}] * 2), [long]) == []
    quote = CardCandidate(kind='answer', text='Long ' * 38, generation_route='source_find')
    assert tighten_cards(FakeLLM([]), [quote]) == []


@pytest.mark.parametrize('text', [
    "The court ruled we're slaves because ____ won't toggle a feature.",
    'Our incredibly elaborate company policy requires ' * 3 + '____.',
])
def test_prompt_length_does_not_trigger_rewrite_or_block_submission(text):
    from forge.models import SubmitCard
    card = CardCandidate(kind='prompt', text=text)
    assert not too_long(card)
    assert tighten_cards(FakeLLM([]), [card]) == [card]
    assert SubmitCard(kind='prompt', text=text, blanks=1, maturity_rating=1, pack='test').text == text


@pytest.mark.parametrize('kind, short, long', [
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
        {'cards': []},
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
        assert '54 characters or fewer; this is a soft target' in call['system']
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
    from forge.text import finish_card_text

    card = CardCandidate(kind='answer', text=text)
    assert too_long(card) is not valid
    fields = dict(kind='answer', text=text, blanks=0, maturity_rating=1, pack='test')
    if valid:
        assert SubmitCard(**fields).text == finish_card_text(text, kind="answer")
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


def test_retry_only_invalid_revisions_with_measured_feedback(caplog):
    import json
    from forge.prompts import FEED_OPEN, FEED_CLOSE
    drafts = [CardCandidate(kind='answer', text='Long ' * 30 + 'answer.') for _ in range(2)]
    llm = FakeLLM([
        {'cards': [{'index': 0, 'text': 'First answer.'}, {'index': 1, 'text': drafts[1].text}]},
        {'cards': [{'index': 0, 'text': 'Must not overwrite ____.'}, {'index': 1, 'text': 'Second answer.'}]},
    ])
    result = tighten_cards(llm, drafts)
    assert [c.text for c in result] == ['First answer.', 'Second answer.']
    request = json.loads(llm.calls[1]['user'].replace(FEED_OPEN, '').replace(FEED_CLOSE, ''))
    assert [row['index'] for row in request] == [1]
    assert 'too_long' in request[0]['validation_error']
    assert request[0]['limits']['characters'] == ANSWER_MAX_CHARS
    assert request[0]['previous_revision']['text'] == drafts[1].text
    assert llm.calls[1]['temperature'] == 0


def test_invalid_kind_label_is_not_allowed_to_erase_valid_shortening():
    draft = CardCandidate(kind='answer', text='Long ' * 30 + 'answer.', writer='writer.deadpan')
    llm = FakeLLM([{'cards': [{'index': 0, 'kind': 'noun', 'text': 'The court.'}]}])
    result = tighten_cards(llm, [draft])
    assert result[0].kind == 'answer' and result[0].writer == draft.writer


def test_omitted_shortening_does_not_retry():
    draft = CardCandidate(kind='answer', text='Long ' * 38)
    llm = FakeLLM([{'cards': []}])
    assert tighten_cards(llm, [draft]) == []
    assert len(llm.calls) == 1


def test_failed_retries_log_reason_and_are_bounded(caplog):
    import logging
    draft = CardCandidate(kind='answer', text='Long ' * 30 + 'answer.')
    llm = FakeLLM([{'cards': [{'index': 0, 'text': draft.text}]}] * 2)
    with caplog.at_level(logging.INFO, logger='forge'):
        assert tighten_cards(llm, [draft]) == []
    assert len(llm.calls) == 2
    final = next(r.extra_fields for r in caplog.records if r.message == 'review.shorten')
    assert final['attempts'] == 2
    assert final['reason'].startswith('too_long:')


def test_answer_soft_character_target_does_not_trigger_rewrite():
    from forge.models import SubmitCard
    from forge.text import finish_card_text
    text = 'A spectacularly unnecessary bureaucratic administrative intervention'
    card = CardCandidate(kind='answer', text=text)
    assert 54 < len(text) < ANSWER_MAX_CHARS
    assert not too_long(card)
    assert tighten_cards(FakeLLM([]), [card]) == [card]
    assert SubmitCard(kind='answer', text=text, blanks=0, maturity_rating=1, pack='test').text == finish_card_text(text, kind="answer")
