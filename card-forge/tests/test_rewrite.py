import pytest
from forge.rewrite import rewrite_denied
from forge.cli import _parse_args
from conftest import FakeLLM, FakeContentClient


def original(**changes):
    return dict(id=17, text='An unnecessarily verbose haunted office printer', kind='answer',
                blanks=0, maturity_rating=2, writer='writer.deadpan', status='denied',
                denied_reason='shorter', pack_slug='test-run', rewrite_of=None, **changes)


def test_rewrite_uses_original_persona_and_submits_directly(settings):
    llm = FakeLLM([{'text': 'A haunted printer'}])
    content = FakeContentClient([original()])
    summary, batch = rewrite_denied(settings, llm, content)
    assert summary.submitted == 1
    assert len(llm.calls) == 1
    assert 'shorter' in llm.calls[0]['user']
    assert 'deadpan' in llm.calls[0]['system'].lower()
    assert batch.payload()['cards'][0] == dict(kind='answer', text='A haunted printer', blanks=0,
        maturity_rating=2, writer='writer.deadpan', pack='test-run', generation_route='review_rewrite', rewrite_of=17)
    assert content.submitted == [batch]


def test_already_rewritten_and_uncommented_and_unknown_writer_skipped(settings):
    parent = original()
    child = {**parent, 'id': 18, 'rewrite_of': 17, 'status': 'pending'}
    uncommented = {**parent, 'id': 19, 'denied_reason': '  '}
    unknown = {**parent, 'id': 20, 'writer': None}
    llm = FakeLLM([])
    content = FakeContentClient([parent, child, uncommented, unknown])
    summary, _ = rewrite_denied(settings, llm, content)
    assert summary.submitted == 0
    assert not llm.calls and not content.submitted


def test_dry_run_does_not_submit(settings):
    content = FakeContentClient([original()])
    _, batch = rewrite_denied(settings, FakeLLM([{'text': 'Haunted toner'}]), content, dry_run=True)
    assert len(batch.cards) == 1
    assert not content.submitted


def test_unchanged_text_not_submitted(settings):
    card = original()
    content = FakeContentClient([card])
    rewrite_denied(settings, FakeLLM([{'text': card['text']}]), content)
    assert not content.submitted


def test_broken_prompt_fails_before_submission(settings):
    card = {**original(), 'kind': 'prompt', 'text': 'Why ____?', 'blanks': 1}
    content = FakeContentClient([card])
    with pytest.raises(ValueError):
        rewrite_denied(settings, FakeLLM([{'text': 'No blank'}]), content)
    assert not content.submitted


def test_cli_rewrite_separate_from_checkpoints():
    assert _parse_args(['--rewrite-denied', '--dry-run']).rewrite_denied
    with pytest.raises(SystemExit):
        _parse_args(['--rewrite-denied', '--run-dir', '/tmp/run'])


def test_attempt_budget_applies_even_when_outputs_are_duplicates(settings):
    settings.batch_max = 1
    first = original()
    second = {**original(), 'id': 18}
    llm = FakeLLM([{'text': first['text']}])
    content = FakeContentClient([first, second])
    rewrite_denied(settings, llm, content)
    assert len(llm.calls) == 1
    assert not content.submitted


@pytest.mark.parametrize('missing', ['pack_slug', 'rewrite_of'])
def test_old_api_fails_before_any_model_calls_or_submission(settings, missing):
    from forge.rewrite import RewriteCompatibilityError
    old_card = {**original(), 'id': 18}
    del old_card[missing]
    # A compatible card first must not trigger a model call before preflight ends.
    content = FakeContentClient([original(), old_card])
    llm = FakeLLM([])
    with pytest.raises(RewriteCompatibilityError, match='Deploy the updated ace-cast server'):
        rewrite_denied(settings, llm, content)
    assert not llm.calls and not content.submitted
