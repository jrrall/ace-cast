import json

import pytest

from forge.checkpoint import Checkpoint
from forge.llm import LLMError
from forge.pipeline import Pipeline
from conftest import FakeContentClient, FakeLLM, rated_selection
from test_dryrun import _scripted_llm, _feed


def test_resume_after_curator_timeout_reuses_all_earlier_calls(settings, tmp_path):
    llm = _scripted_llm()
    llm._responses.pop()

    def timeout(_):
        raise LLMError('timeout')

    llm._responses.append(timeout)
    content = FakeContentClient()
    with Checkpoint(tmp_path, settings) as checkpoint:
        with pytest.raises(LLMError):
            Pipeline(settings, llm, content, fetch_fn=lambda s: _feed(), checkpoint=checkpoint).run(dry_run=True)
    assert content.submitted == []
    saved = json.loads((tmp_path / 'moderated.json').read_text())
    assert len(saved['cards']) == 3
    assert saved['cards'][0]['writer'] == 'writer.deadpan'
    assert not (tmp_path / 'final.json').exists()

    def no_fetch(_):
        pytest.fail('Resume must reuse saved research')

    resumed_llm = FakeLLM([rated_selection([0, 1, 2])])
    settings.llm_timeout = 600  # operational changes are allowed
    with Checkpoint(tmp_path, settings, resume=True) as checkpoint:
        summary, batch = Pipeline(settings, resumed_llm, content, fetch_fn=no_fetch, checkpoint=checkpoint).run(dry_run=True)
    assert len(resumed_llm.calls) == 1
    assert len(batch.cards) == 3
    assert summary.generated == 3
    assert json.loads((tmp_path / 'final.json').read_text()) == batch.payload()


def test_completed_submission_is_not_repeated(settings, tmp_path):
    content = FakeContentClient()
    with Checkpoint(tmp_path, settings) as checkpoint:
        _, original = Pipeline(settings, _scripted_llm(), content, fetch_fn=lambda s: _feed(), checkpoint=checkpoint).run()
    with Checkpoint(tmp_path, settings, resume=True) as checkpoint:
        _, resumed = Pipeline(settings, FakeLLM([]), content, checkpoint=checkpoint).run()
    assert len(content.submitted) == 1
    assert resumed == original


def test_uncertain_submission_requires_reconciliation(settings, tmp_path):
    content = FakeContentClient(submit_error=RuntimeError('connection lost'))
    with Checkpoint(tmp_path, settings) as checkpoint:
        with pytest.raises(RuntimeError):
            Pipeline(settings, _scripted_llm(), content, fetch_fn=lambda s: _feed(), checkpoint=checkpoint).run()
    with Checkpoint(tmp_path, settings, resume=True) as checkpoint:
        with pytest.raises(ValueError, match='uncertain'):
            Pipeline(settings, FakeLLM([]), content, checkpoint=checkpoint).run()


def test_checkpoint_guards_and_no_credentials(settings, tmp_path):
    with Checkpoint(tmp_path, settings):
        with pytest.raises(BlockingIOError):
            with Checkpoint(tmp_path, settings, resume=True):
                pass
    manifest = (tmp_path / 'manifest.json').read_text()
    assert 'test-key' not in manifest
    assert 'test-token' not in manifest
    with pytest.raises(ValueError, match='not empty'):
        with Checkpoint(tmp_path, settings):
            pass
    settings.quality_min = 95
    with pytest.raises(ValueError, match='same model'):
        with Checkpoint(tmp_path, settings, resume=True):
            pass


def test_failed_call_is_not_cached_and_prompt_changes_invalidate_cache(settings, tmp_path):
    with Checkpoint(tmp_path, settings) as checkpoint:
        llm = FakeLLM([{'cards': []}, {'cards': ['changed']}])
        wrapped = checkpoint.wrap(llm)
        assert wrapped.complete_json(system='a', user='b') == {'cards': []}
        assert wrapped.complete_json(system='a', user='b') == {'cards': []}
        assert wrapped.complete_json(system='a', user='c') == {'cards': ['changed']}
        assert len(llm.calls) == 2


def test_resume_reuses_completed_editor_chunks(settings, tmp_path, sample_candidates):
    from forge.personas import Editor
    settings.editor_batch_size = 2

    def timeout(_):
        raise LLMError('timeout')

    first = {'cards': [{'source_index': 1, 'kind': 'answer', 'text': 'A haunted Roomba.'}]}
    second = {'cards': [{'source_index': 0, 'kind': 'answer', 'text': 'Crippling student debt.'}]}
    with Checkpoint(tmp_path, settings) as checkpoint:
        with pytest.raises(LLMError):
            Editor(checkpoint.wrap(FakeLLM([first, timeout])), settings).run(sample_candidates)
    assert len(list((tmp_path / 'calls').glob('*.json'))) == 1
    llm = FakeLLM([second])
    with Checkpoint(tmp_path, settings, resume=True) as checkpoint:
        edited = Editor(checkpoint.wrap(llm), settings).run(sample_candidates)
    assert len(llm.calls) == 1
    assert len(edited) == 2


def test_moderation_resume_after_chunk_timeout_and_changed_chunk_size(settings, tmp_path, sample_candidates):
    from forge.personas import Moderator
    settings.moderator_batch_size = 1
    ok = {'verdicts': [{'index': 0, 'allowed': True, 'maturity_rating': 1}]}

    def timeout(_):
        raise LLMError('timeout')

    with Checkpoint(tmp_path, settings) as checkpoint:
        with pytest.raises(LLMError):
            Moderator(checkpoint.wrap(FakeLLM([ok, timeout])), settings).run(sample_candidates)
    llm = FakeLLM([ok, ok])
    with Checkpoint(tmp_path, settings, resume=True) as checkpoint:
        cards = Moderator(checkpoint.wrap(llm), settings).run(sample_candidates)
    assert len(cards) == 3
    assert len(llm.calls) == 2
    settings.moderator_batch_size = 2
    settings.curator_batch_size = 3
    with Checkpoint(tmp_path, settings, resume=True):
        pass


def test_curator_repairs_cached_invalid_schema_without_repeating_valid_call(settings, tmp_path, sample_moderated):
    from forge.personas import Curator
    bad = {'selected': [0], 'evaluations': [
        {'index': 0, 'quality': 14.5, 'premise_group': 'test'},
    ]}
    settings.llm_json_retries = 0
    with Checkpoint(tmp_path, settings) as checkpoint:
        with pytest.raises(ValueError):
            Curator(checkpoint.wrap(FakeLLM([bad])), FakeContentClient(), settings).run(sample_moderated)
    settings.llm_json_retries = 1
    repair = FakeLLM([rated_selection([0])])
    with Checkpoint(tmp_path, settings, resume=True) as checkpoint:
        batch = Curator(checkpoint.wrap(repair), FakeContentClient(), settings).run(sample_moderated)
    assert len(batch.cards) == 1
    assert len(repair.calls) == 1
    with Checkpoint(tmp_path, settings, resume=True) as checkpoint:
        replay = Curator(checkpoint.wrap(FakeLLM([])), FakeContentClient(), settings).run(sample_moderated)
    assert replay.payload() == batch.payload()



def test_old_checkpoint_retains_six_writer_roster(settings, tmp_path):
    with Checkpoint(tmp_path, settings) as cp:
        assert len(cp.writer_names) == 9
        manifest = cp.read('manifest')
        manifest.pop('writer_names')
        manifest['settings'].update(opposites_round=False, opposites_setups=2, opposites_answers=2)
        cp.write('manifest', manifest)
    with Checkpoint(tmp_path, settings, resume=True) as cp:
        assert len(cp.writer_names) == 6
        assert 'writer.toxic_positivity' not in cp.writer_names


def test_run_directory_names_pack_and_survives_directory_move(settings, tmp_path):
    path = tmp_path/'qwen35-20260926-134926'
    with Checkpoint(path, settings) as cp:
        _, batch = Pipeline(settings, _scripted_llm(), FakeContentClient(),
                            fetch_fn=lambda _: _feed(), checkpoint=cp).run(dry_run=True)
        assert batch.pack == path.name
        assert all(c.pack == path.name for c in batch.cards)
        assert batch.payload()['run_pack'] == {'slug': path.name, 'base_pack': settings.pack_slug}
    moved = tmp_path/'renamed-folder'
    path.rename(moved)
    with Checkpoint(moved, settings, resume=True) as cp:
        assert cp.pack_slug == path.name


def test_legacy_submitted_checkpoint_keeps_original_pack(settings, tmp_path):
    with Checkpoint(tmp_path, settings) as cp:
        manifest = cp.read('manifest')
        manifest.pop('run_pack')
        cp.write('manifest', manifest)
        cp.write('submission', {'status': 'started', 'batch': {'pack': settings.pack_slug}})
    with Checkpoint(tmp_path, settings, resume=True) as cp:
        assert cp.pack_slug is None
