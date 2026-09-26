"""Atomic local checkpoints and replay of completed model calls."""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
from pathlib import Path

from .logging_setup import get_logger


class Checkpoint:
    def __init__(self, directory, settings, *, resume=False):
        self.path = Path(directory)
        self.settings = settings
        self.resume = resume
        self.lock = None

    def __enter__(self):
        self.path.mkdir(parents=True, exist_ok=True)
        self.lock = (self.path / '.lock').open('a')
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            # Credentials are never written. Operational timeouts/retries may change
            # on resume, but model, generation and review settings must match.
            config = self.settings.model_dump(mode='json', exclude={
                'llm_api_key', 'content_api_token', 'llm_timeout', 'llm_max_retries',
                'llm_json_retries', 'content_api_timeout', 'feed_timeout', 'comedy_trace_path',
                'moderator_batch_size', 'curator_batch_size', 'personas_dir', 'persona_scout',
            })
            manifest = self.read('manifest')
            if self.resume:
                if manifest is None or manifest.get('version') != 1:
                    raise ValueError('No supported checkpoint found; start a new run directory')
                saved_config = {k: v for k, v in manifest['settings'].items()
                                if k not in ('moderator_batch_size', 'curator_batch_size', 'personas_dir', 'persona_scout')}
                if manifest.get('scout_protocol') != 'batches-v1':
                    saved_config.pop('scout_batch_size', None)
                    config.pop('scout_batch_size', None)
                saved_config.setdefault('writers_per_run', 0)
                saved_config.setdefault('scout_excerpt_chars', 800)
                if saved_config.pop('opposites_round', False):
                    raise ValueError('Legacy swap-round checkpoint requires its original image')
                saved_config.pop('opposites_setups', None)
                saved_config.pop('opposites_answers', None)
                if saved_config != config:
                    raise ValueError('Resume requires the same model/generation/review settings; timeouts may change')
            else:
                if any(p.name != '.lock' for p in self.path.iterdir()):
                    raise ValueError('Run directory is not empty; use --resume or a new directory')
                from .persona_registry import select_personas
                profiles = select_personas(self.settings)
                manifest = {'version': 1, 'settings': config,
                            'persona_scout': self.settings.persona_scout,
                            'scout_protocol': 'batches-v1',
                            'writer_names': [p.writer_name for p in profiles],
                            'personas': [p.model_dump() for p in profiles],
                            'persona_versions': {p.writer_name: p.version for p in profiles}}
                self.write('manifest', manifest)
            from .personas.writer import WRITER_TYPES
            self.writer_names = manifest.get('writer_names', [
                w.name for w in WRITER_TYPES if w.name != 'writer.toxic_positivity'
            ])
            self.scout_protocol = manifest.get('scout_protocol', 'legacy')
            self.persona_scout = manifest.get('persona_scout', False)
            from .persona_registry import Persona, select_personas
            if 'personas' in manifest and 'writer_names' in manifest:
                self.personas = [Persona.model_validate(p) for p in manifest['personas']]
                if ([p.writer_name for p in self.personas] != self.writer_names
                        or any(not {'write', 'answer', 'critique', 'revise'}.issubset(p.phases)
                               or (self.persona_scout and 'scout' not in p.phases)
                               for p in self.personas)):
                    raise ValueError('Invalid saved persona snapshot')
            else:
                # Old runs did not freeze definitions. Freeze the current matching
                # roster on their first resume; earlier prompt text is unrecoverable.
                self.personas = select_personas(self.settings, names=self.writer_names)
                manifest.update(writer_names=self.writer_names,
                                personas=[p.model_dump() for p in self.personas],
                                persona_versions={p.writer_name: p.version for p in self.personas})
                self.write('manifest', manifest)
                get_logger().warning('checkpoint.legacy_personas_frozen')
            return self
        except BaseException:
            self.lock.close()
            raise

    def __exit__(self, *args):
        self.lock.close()

    def read(self, name):
        path = self.path / f'{name}.json'
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding='utf-8'))

    def write(self, name, data):
        path = self.path / f'{name}.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix('.tmp')
        with temp.open('w', encoding='utf-8') as output:
            json.dump(data, output, ensure_ascii=False, indent=2)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp, path)

    def wrap(self, llm):
        return CheckpointLLM(llm, self)


class CheckpointLLM:
    def __init__(self, llm, checkpoint):
        self.llm = llm
        self.checkpoint = checkpoint

    def complete_json(self, *, system, user, temperature=0.8):
        request = {'system': system, 'user': user, 'temperature': temperature}
        digest = hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()
        name = f'calls/{digest}'
        cached = self.checkpoint.read(name)
        if cached is not None:
            get_logger().info('checkpoint.call_reused', extra={'extra_fields': {'call': digest}})
            return cached['response']
        response = self.llm.complete_json(**request)
        self.checkpoint.write(name, {'request': request, 'response': response})
        return response
