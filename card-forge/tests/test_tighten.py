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
