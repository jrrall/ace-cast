import pytest
from forge.models import CardCandidate
from forge.personas import Editor, Moderator, Curator
from forge.personas.writer import UnhingedWriter
from conftest import FakeLLM, FakeContentClient, rated_selection


def test_author_survives_rewrite_moderation_and_submission(settings, sample_theme):
    llm = FakeLLM([
        {'cards': [{'kind': 'answer', 'text': 'An original draft.', 'writer': 'writer.fake'}]},
        {'cards': [{'source_index': 0, 'kind': 'answer', 'text': 'An edited draft.', 'writer': 'writer.fake'}]},
        {'verdicts': [{'index': 0, 'allowed': True, 'maturity_rating': 3}]},
        rated_selection([0]),
    ])
    settings.maturity_max = 3
    drafts = UnhingedWriter(llm, settings).run(sample_theme)
    assert drafts[0].writer == 'writer.unhinged'
    edited = Editor(llm, settings).run(drafts)
    moderated = Moderator(llm, settings).run(edited)
    batch = Curator(llm, FakeContentClient(), settings).run(moderated)
    assert batch.payload()['cards'][0]['writer'] == 'writer.unhinged'
    assert batch.cards[0].text == 'An edited draft.'


@pytest.mark.parametrize('index', [True, -1, 8, '0', None])
def test_invalid_source_cannot_claim_authorship(settings, index):
    draft = CardCandidate(kind='answer', text='A draft.', writer='writer.deadpan')
    llm = FakeLLM([{'cards': [{'source_index': index, 'kind': 'answer', 'text': 'A rewrite.'}]}])
    assert Editor(llm, settings).run([draft]) == []


def test_missing_source_only_recovers_unique_unchanged_draft(settings):
    draft = CardCandidate(kind='answer', text='A draft.', writer='writer.deadpan')
    llm = FakeLLM([{'cards': [
        {'kind': 'answer', 'text': 'A draft.'},
        {'kind': 'answer', 'text': 'An unattributable rewrite.'},
    ]}])
    edited = Editor(llm, settings).run([draft])
    assert len(edited) == 1
    assert edited[0].writer == 'writer.deadpan'


def test_ambiguous_identical_drafts_do_not_guess_writer(settings):
    drafts = [CardCandidate(kind='answer', text='Same draft.', writer=writer)
              for writer in ['writer.deadpan', 'writer.unhinged']]
    llm = FakeLLM([{'cards': [{'kind': 'answer', 'text': 'Same draft.'}]}])
    assert Editor(llm, settings).run(drafts) == []
