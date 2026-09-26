from forge.source_finds import find_cards
from forge.feeds import FeedItem
from forge.models import Theme
from conftest import FakeLLM, FakeContentClient, rated_selection


def item():
    return FeedItem(title='Pop star wordplay', source='b3ta forum anecdotes', finds=[
        {'text': 'Urethra Franklin', 'url': 'https://b3ta.com/questions/imagechallenge/post1'},
        {'text': 'Bellender Carlisle', 'url': 'https://b3ta.com/questions/imagechallenge/post1'},
        {'text': 'Willy Ocean', 'url': 'https://b3ta.com/questions/imagechallenge/post1'}])


def test_exact_find_and_post_limit_no_invented_writer():
    cards = find_cards(FakeLLM([{'selected': [True, 99, 0, 0, 1, 2]}]), [item()])
    assert [c.text for c in cards] == ['Urethra Franklin', 'Bellender Carlisle']
    assert all(c.writer is None and c.source_url and c.generation_route == 'source_find' for c in cards)
    assert find_cards(FakeLLM([]), [item()], 0) == []


def test_find_bypasses_rewriting_reaches_judgment_with_source(settings, monkeypatch):
    from forge.pipeline import Pipeline
    from forge.personas import Trendscout
    def research(self):
        self.fetched = [item()]
        return [Theme(title='Rule')]
    monkeypatch.setattr(Trendscout, 'run', research)
    llm = FakeLLM([{'cards': []} for _ in range(9)] + [
        {'selected': [0]}, {'verdicts': [{'index': 0, 'allowed': True, 'maturity_rating': 2}]}, rated_selection([0])])
    summary, batch = Pipeline(settings, llm, FakeContentClient()).run(dry_run=True)
    card = batch.payload()['cards'][0]
    assert card['text'] == 'Urethra Franklin'
    assert card['generation_route'] == 'source_find'
    assert card['source_url'].endswith('/post1')
    assert 'writer' not in card
