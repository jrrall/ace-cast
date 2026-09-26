"""Creative direction is injected from profiles, not shared house-style prompts."""
from forge.persona_registry import Persona
from forge.personas.writer import Writer, SYSTEM as WRITER_SYSTEM
from forge.personas.editor import SYSTEM as EDITOR_SYSTEM
from forge.personas.curator import SYSTEM as CURATOR_SYSTEM
from forge.personas.trendscout import SYSTEM as SCOUT_SYSTEM
from forge.scout_batches import SYSTEM as BATCH_SYSTEM
from forge.prompts import maturity_direction
from conftest import FakeLLM


def test_persona_voice_and_each_phase_are_injected_once(settings):
    phases = {name: f'Direction unique to {name}.' for name in ('scout', 'write', 'answer', 'critique', 'revise')}
    persona = Persona(id='custom', name='Custom', voice='The custom persona controls all comic choices.', phases=phases)
    writer = Writer(FakeLLM([]), settings, definition=persona)
    for phase, direction in phases.items():
        prompt = writer.phase_system(phase)
        assert prompt.count(persona.voice) == 1
        assert prompt.count(direction) == 1
        assert all(other not in prompt for name, other in phases.items() if name != phase)


def test_shared_prompts_do_not_inject_house_style_or_persona_recipes():
    shared = '\n'.join((WRITER_SYSTEM, EDITOR_SYSTEM, CURATOR_SYSTEM, SCOUT_SYSTEM,
                        BATCH_SYSTEM, *(maturity_direction(i) for i in range(4)))).lower()
    for unwanted in ('burnout', 'gen z', 'millennial', 'furry convention', 'side hustles',
                     'therapy bills', 'sponsored apology', 'betting app', 'domestic jealousy',
                     'target extreme adult comedy', 'hatemonger', 'toxic positivity'):
        assert unwanted not in shared
    assert 'source_index' in EDITOR_SYSTEM
    assert 'premise_group' in CURATOR_SYSTEM
    assert 'story_id' in BATCH_SYSTEM
