"""Validated, editable persona definitions and resolved phase defaults."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import random
import tomllib

from pydantic import BaseModel, ConfigDict, Field, field_validator

BUILTIN_DIR = Path(__file__).with_name('persona_profiles')
PHASES = {'scout', 'write', 'answer', 'critique', 'revise'}


class Persona(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    id: str = Field(pattern=r'^[a-z][a-z0-9_-]*$')
    name: str = Field(min_length=1)
    enabled: bool = True
    order: int = 100
    voice: str = Field(min_length=1)
    phases: dict[str, str] = Field(default_factory=dict)

    @field_validator('voice', 'name')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('must not be blank')
        return value

    @field_validator('phases')
    @classmethod
    def valid_phases(cls, value):
        if set(value) - PHASES or any(not v.strip() for v in value.values()):
            raise ValueError('phases must be nonblank scout, write, answer, critique, or revise instructions')
        return value

    @property
    def writer_name(self):
        return 'writer.' + self.id

    @property
    def version(self):
        return hashlib.sha256(json.dumps(self.model_dump(), sort_keys=True).encode()).hexdigest()


def default_phases(directory=BUILTIN_DIR):
    with (BUILTIN_DIR / '_defaults.toml').open('rb') as source:
        phases = tomllib.load(source)['phases']
    override = Path(directory) / '_defaults.toml'
    if Path(directory) != BUILTIN_DIR and override.exists():
        with override.open('rb') as source:
            data = tomllib.load(source)
        if set(data) != {'phases'}:
            raise ValueError('_defaults.toml only accepts [phases]')
        phases.update(Persona.valid_phases(data['phases']))
    return phases


def load_personas(directory=None):
    directory = Path(directory) if directory else BUILTIN_DIR
    phases = default_phases(directory)
    profiles, seen = [], set()
    for path in sorted(directory.glob('*.toml')):
        if path.name == '_defaults.toml':
            continue
        try:
            with path.open('rb') as source:
                profile = Persona.model_validate(tomllib.load(source))
            if profile.id in seen:
                raise ValueError(f'duplicate persona id: {profile.id}')
            seen.add(profile.id)
            profiles.append(profile.model_copy(update={'phases': phases | profile.phases}))
        except (ValueError, TypeError) as exc:
            raise ValueError(f'Invalid persona file {path}: {exc}') from exc
    if not profiles:
        raise ValueError(f'No persona TOML files found in {directory}')
    return sorted(profiles, key=lambda p: (p.order, p.id))


def select_personas(settings, *, names=None):
    profiles = load_personas(settings.personas_dir or None)
    if names is not None:
        by_name = {p.writer_name: p for p in profiles}
        if 'writer.banned_from_the_thread' in names and 'writer.banned_from_4chan' in by_name:
            by_name['writer.banned_from_the_thread'] = by_name['writer.banned_from_4chan'].model_copy(
                update={'id': 'banned_from_the_thread'})
        if not names or len(set(names)) != len(names) or any(n not in by_name for n in names):
            raise ValueError('Invalid saved writer roster')
        return [by_name[n] for n in names]
    profiles = [p for p in profiles if p.enabled]
    if not profiles:
        raise ValueError('No enabled personas')
    count = settings.writers_per_run
    if count > len(profiles):
        raise ValueError('WRITERS_PER_RUN exceeds enabled personas')
    if count:
        chosen = set(random.sample(range(len(profiles)), count))
        profiles = [p for i, p in enumerate(profiles) if i in chosen]
    return profiles
