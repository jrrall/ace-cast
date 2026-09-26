import json

import pytest

from forge.checkpoint import Checkpoint
from forge.persona_registry import load_personas, select_personas
from forge.personas.writer import writing_team
from forge.comedy_room import ComedyRoom
from conftest import FakeLLM


def profile(directory, ident='custom', extra='', voice='Original voice.'):
    directory.mkdir(exist_ok=True)
    path = directory / f'{ident}.toml'
    path.write_text(f'id = "{ident}"\nname = "Custom"\nvoice = "{voice}"\n' + extra)
    return path


def test_phase_defaults_overrides_and_answer_execution(settings, tmp_path):
    profile(tmp_path, extra='[phases]\nanswer = "Custom answer direction."\n')
    (tmp_path / '_defaults.toml').write_text('[phases]\ncritique = "Custom shared critique."\n')
    settings.personas_dir = str(tmp_path)
    llm = FakeLLM([{'cards': [{'kind': 'answer', 'text': 'A ceremonial toilet.'}]}])
    writer, = writing_team(llm, settings)
    assert 'Custom shared critique.' in writer.phase_system('critique')
    assert 'Invent distinct playable cards' in writer.phase_system('write')
    assert 'Custom answer direction.' not in writer.phase_system('write')
    assert writer.answer('We celebrated with ____.')[0].writer == 'writer.custom'
    assert 'Custom answer direction.' in llm.calls[0]['system']


@pytest.mark.parametrize('extra', [
    'enabled = "yes"', 'unknown = 1', '[phases]\nrewrite = "typo"',
    '[phases]\nwrite = " "',
])
def test_invalid_profiles_fail_with_filename(tmp_path, extra):
    profile(tmp_path, extra=extra)
    with pytest.raises(ValueError, match='custom.toml'):
        load_personas(tmp_path)


def test_duplicates_and_empty_rosters_fail(settings, tmp_path):
    path = profile(tmp_path, extra='enabled = false')
    settings.personas_dir = str(tmp_path)
    with pytest.raises(ValueError, match='No enabled'):
        select_personas(settings)
    (tmp_path/'duplicate.toml').write_text(path.read_text())
    with pytest.raises(ValueError, match='duplicate persona id'):
        load_personas(tmp_path)


def test_selected_roster_and_resolved_prompts_survive_file_edits(settings, tmp_path):
    directory = tmp_path/'profiles'
    for i in range(10):
        profile(directory, f'custom{i}')
    settings.personas_dir = str(directory)
    settings.writers_per_run = 6
    with Checkpoint(tmp_path/'run', settings) as cp:
        first = cp.personas
        assert len(first) == len(set(cp.writer_names)) == 6
        assert cp.read('manifest')['persona_versions'] == {p.writer_name: p.version for p in first}
    # Resume must not even require the original files to exist.
    for path in directory.iterdir():
        path.unlink()
    with Checkpoint(tmp_path/'run', settings, resume=True) as cp:
        assert cp.personas == first
        writers = writing_team(FakeLLM([]), settings, definitions=cp.personas)
        assert [w.name for w in writers] == cp.writer_names
        assert all('Original voice.' in w.phase_system('write') for w in writers)


def test_custom_roster_uses_phase_overrides_in_comedy_loop(settings, tmp_path, sample_theme):
    for ident in ('alpha', 'beta'):
        profile(tmp_path, ident, extra=f'[phases]\ncritique = "Critique as {ident}."\nrevise = "Revise as {ident}."\n')
    settings.personas_dir = str(tmp_path)
    llm = FakeLLM([
        {'cards': [{'kind': 'answer', 'text': 'A ceremonial toilet.'}]},
        {'cards': [{'kind': 'answer', 'text': 'A sponsored confession.'}]},
        {'challenges': [{'index': 0, 'kind': 'answer', 'text': 'A gold ceremonial toilet.', 'critique': 'Add a detail.'}]},
        {'revisions': []},
        {'challenges': []},
    ])
    result = ComedyRoom(llm, settings, emit=lambda _: None).run([sample_theme])
    assert len(result) == 2
    assert 'Critique as beta.' in llm.calls[2]['system']
    assert 'Revise as alpha.' in llm.calls[3]['system']
    assert 'Critique as alpha.' in llm.calls[4]['system']


def test_saved_eight_writer_run_does_not_gain_new_persona(settings, tmp_path):
    with Checkpoint(tmp_path/'run', settings) as cp:
        manifest = cp.read('manifest')
        manifest['personas'] = [p for p in manifest['personas'] if p['id'] != 'super_bitch']
        manifest['writer_names'].remove('writer.super_bitch')
        manifest['persona_versions'].pop('writer.super_bitch')
        cp.write('manifest', manifest)
    with Checkpoint(tmp_path/'run', settings, resume=True) as cp:
        writers = writing_team(FakeLLM([]), settings, definitions=cp.personas)
        assert len(writers) == 8
        assert all(w.name != 'writer.super_bitch' for w in writers)
    assert 'writer.super_bitch' in {p.writer_name for p in select_personas(settings)}
