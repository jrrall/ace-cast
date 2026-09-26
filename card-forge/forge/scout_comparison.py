"""Bounded, local-only comparison of fresh full-pool and batched scout calls."""
import hashlib
import json
import logging
import statistics
import time
from pathlib import Path

from .config import Settings
from .feeds import FeedItem
from .llm import LLMClient
from .logging_setup import get_logger
from .persona_registry import Persona
from .personas.trendscout import Trendscout
from .personas.writer import writing_team
from .scout_batches import make_batches, scout_batches
from .stories import stories_from_items


class BudgetExceeded(RuntimeError):
    pass


def save(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def append(path, value):
    with path.open('a') as stream:
        stream.write(json.dumps(value, ensure_ascii=False) + '\n')
        stream.flush()


class Recorder(logging.Handler):
    def __init__(self, path):
        super().__init__()
        self.path, self.events, self.context = path, [], {}

    def emit(self, record):
        if record.getMessage() not in ('scout.attempt', 'scout.reused'):
            return
        event = {**self.context, 'event': record.getMessage(), 'timestamp': record.created, **record.extra_fields}
        self.events.append(event)
        append(self.path, event)


class FreshCalls:
    """No response cache; bound both total calls and the remaining wall time."""
    def __init__(self, settings, output, *, max_calls, max_seconds, factory=LLMClient):
        self.settings, self.output, self.factory = settings, output, factory
        self.max_calls, self.deadline = max_calls, time.monotonic() + max_seconds
        self.calls, self.context = [], {}

    def complete_json(self, *, system, user, temperature=0.8):
        self.last_call_source = 'budget'
        self.last_call_stats = {'model_attempts': 0, 'format_retries': 0}
        remaining = self.deadline - time.monotonic()
        if len(self.calls) >= self.max_calls or remaining <= 0:
            raise BudgetExceeded('comparison call/time budget exhausted')
        # Reserve enough time for every format attempt. SDK transport retries are disabled.
        settings = self.settings.model_copy(update={
            'llm_timeout': min(self.settings.llm_timeout, remaining / (self.settings.llm_json_retries + 1)),
            'llm_max_retries': 0,
        })
        llm = self.factory(settings)
        record = {**self.context, 'call': len(self.calls) + 1, 'timestamp': time.time(),
                  'request': {'system': system, 'user': user, 'temperature': temperature},
                  'input_chars': len(system) + len(user), 'timeout_s': settings.llm_timeout}
        self.calls.append(record)
        append(self.output/'calls.jsonl', {**record, 'event': 'started'})
        started = time.monotonic()
        self.last_call_source = 'generation'
        try:
            response = llm.complete_json(system=system, user=user, temperature=temperature)
            record['response'] = response
            return response
        except BaseException as exc:
            record['error_type'] = type(exc).__name__
            raise
        finally:
            self.last_call_stats = getattr(llm, 'last_call_stats', {'model_attempts': 1, 'format_retries': 0}).copy()
            record.update(duration_s=round(time.monotonic() - started, 6), **self.last_call_stats)
            append(self.output/'calls.jsonl', {**record, 'event': 'finished'})
            # The benchmark creates isolated clients so per-call deadlines cannot affect production runs.
            if isinstance(llm, LLMClient):
                llm._client.close()


def summarize(events, outcomes, calls):
    result = {}
    for arm in ('full_pool', 'batches'):
        attempts = [e for e in events if e['arm'] == arm]
        fresh = [e for e in attempts if e['source'] == 'generation']
        sizes = [e['input_chars'] for e in fresh]
        scouts = [o for o in outcomes if o['arm'] == arm and o['stage'] == 'scout']
        themes = [t for o in scouts for t in o.get('themes', [])]
        cards = [c for o in outcomes if o['arm'] == arm for c in o.get('cards', [])]
        result[arm] = {
            'scout_generation_s': round(sum(e['duration_s'] for e in fresh), 3),
            'scout_observed_s': round(sum(e['duration_s'] for e in attempts), 3),
            'scout_model_attempts': sum(e.get('model_attempts', 0) for e in fresh),
            'cache_reuses': sum(e['source'] == 'cache' for e in attempts),
            'checkpoint_reuses': sum(e['source'] == 'checkpoint' for e in attempts),
            'request_chars': {'min': min(sizes, default=0), 'median': statistics.median(sizes) if sizes else 0,
                              'max': max(sizes, default=0), 'total': sum(sizes)},
            'schema_retries': sum(e['attempt'] > 1 for e in fresh),
            'validation_failures': sum(e['validation_failed'] for e in fresh),
            'format_retries': sum(e.get('format_retries', 0) for e in fresh),
            'failed_scout_units': sum(o['status'] == 'failed' for o in scouts),
            'completed_scout_units': sum(o['status'] == 'complete' for o in scouts),
            'null_scout_units': sum(o['status'] == 'complete' and not o['themes'] for o in scouts),
            'selected_themes': len(themes),
            'distinct_stories': len({t['story_id'] for t in themes}),
            'distinct_sources': sorted({t['source'] for t in themes}),
            'distinct_angles': len({t['angle'] for t in themes}),
            'themes_by_persona': {name: sum(len(o.get('themes', [])) for o in scouts if o['persona'] == name)
                                  for name in sorted({o['persona'] for o in scouts})},
            'writer_generation_s': round(sum(c['duration_s'] for c in calls if c['arm'] == arm and c['stage'] == 'write'), 3),
            'writer_failures': sum(o['status'] == 'failed' for o in outcomes if o['arm'] == arm and o['stage'] == 'write'),
            'cards': len(cards), 'distinct_card_texts': len({c['text'].strip().casefold() for c in cards}),
            'cards_by_kind': {kind: sum(c['kind'] == kind for c in cards) for kind in ('prompt', 'answer')},
        }
    return result


def compare(source, output, connection, *, persona_count=2, max_calls=24, max_seconds=900,
            timeout=90, base_url=None, factory=LLMClient):
    if not 1 <= persona_count <= 7 or max_calls < 1 or max_seconds <= 0 or timeout <= 0:
        raise ValueError('persona count must be 1..7 and budgets must be positive')
    source, output = Path(source), Path(output)
    manifest = json.loads((source/'manifest.json').read_text())
    research = json.loads((source/'research.json').read_text())
    definitions = [Persona.model_validate(p) for p in manifest['personas']]
    if [p.writer_name for p in definitions] != manifest['writer_names']:
        raise ValueError('Saved roster does not match persona definitions')
    stories = research.get('stories')
    if stories is None:
        stories = stories_from_items([FeedItem(**item) for item in research['items']])
    settings = Settings(_env_file=None, **{**manifest['settings'], 'llm_api_key': connection.llm_api_key,
                                          'llm_timeout': timeout, 'llm_max_retries': 0,
                                          'llm_json_retries': connection.llm_json_retries,
                                          **({'llm_base_url': base_url} if base_url else {})})
    output.mkdir(parents=True, exist_ok=False)  # never mix fresh measurements with an earlier run
    safe_settings = settings.model_dump(mode='json', exclude={'llm_api_key', 'content_api_token'})
    snapshot = {'source_run': str(source.resolve()), 'settings': safe_settings,
                'personas': [p.model_dump() for p in definitions], 'stories': stories,
                'compared_personas': [p.writer_name for p in definitions[:persona_count]],
                'max_calls': max_calls, 'max_seconds': max_seconds,
                'temperature': 0.8, 'cache': 'disabled', 'review': 'existing admin approval loop'}
    fingerprint = hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()
    snapshot['fingerprint'] = fingerprint
    save(output/'inputs.json', snapshot)
    llm = FreshCalls(settings, output, max_calls=max_calls, max_seconds=max_seconds, factory=factory)
    writers = writing_team(llm, settings, definitions=definitions)  # preserve full-roster card budgets
    selected = writers[:persona_count]
    recorder = Recorder(output/'scout-events.jsonl')
    logger = get_logger()
    logger.addHandler(recorder)
    outcomes, chosen = [], {}
    status = 'complete'

    def execute(context, operation):
        llm.context = recorder.context = context
        row = {**context, 'status': 'complete'}
        try:
            value = operation()
            row.update(value)
        except BudgetExceeded:
            row['status'] = 'budget_exhausted'
            raise
        except Exception as exc:
            row.update(status='failed', error_type=type(exc).__name__)
        except BaseException as exc:
            row.update(status='interrupted', error_type=type(exc).__name__)
            raise
        finally:
            outcomes.append(row)
            save(output/'outcomes.json', outcomes)
        return row

    def record_themes(arm, writer, themes):
        chosen.setdefault((arm, writer.name), []).extend(themes)
        rows = []
        for theme in themes:
            story_id = next(s['id'] for s in stories if s['source'] == theme.source and s['url'] == theme.url
                            and (s['title'] + '\n' + s['excerpt']).strip() == theme.raw_excerpt)
            rows.append({**theme.model_dump(mode='json'), 'story_id': story_id})
        return {'themes': rows}

    try:
        # Alternate route order by persona to reduce a fixed first-route warm-up bias.
        for index, writer in enumerate(selected):
            for arm in (('full_pool', 'batches') if index % 2 == 0 else ('batches', 'full_pool')):
                if arm == 'full_pool':
                    execute({'arm': arm, 'persona': writer.name, 'stage': 'scout', 'batch': 0},
                            lambda: record_themes(arm, writer, Trendscout(llm, settings).for_stories(writer, stories)))
                else:
                    batches = make_batches(stories, index, settings.scout_batch_size, settings.themes_per_run)
                    for batch_index, batch in enumerate(batches):
                        execute({'arm': arm, 'persona': writer.name, 'stage': 'scout', 'batch': batch_index},
                                lambda: record_themes(arm, writer, scout_batches(llm, settings, writer, [batch],
                                                                               batch_offset=batch_index)))
        for index, writer in enumerate(selected):
            for arm in (('full_pool', 'batches') if index % 2 == 0 else ('batches', 'full_pool')):
                for theme_index, theme in enumerate(chosen.get((arm, writer.name), [])):
                    execute({'arm': arm, 'persona': writer.name, 'stage': 'write', 'theme': theme_index},
                            lambda: {'cards': [c.model_dump(mode='json') for c in writer.run(theme)]})
    except BudgetExceeded:
        status = 'budget_exhausted'
    except BaseException:
        status = 'interrupted'
        raise
    finally:
        logger.removeHandler(recorder)
        report = {'status': status, 'input_fingerprint': fingerprint,
                  'results': summarize(recorder.events, outcomes, llm.calls),
                  'limits': ['Single local sample; stochastic outputs and server warm-up can affect timing.',
                             'Fresh calls only; no response-cache or checkpoint replay included in generation time.',
                             'Timeout durations are censored; missing drafts after failures are not a card-quality result.',
                             'Draft counts and lexical variety do not measure humor or persona quality.',
                             'No moderation, curation, critique/revision, or publication; existing admin approval remains the review path.',
                             'JSON format/schema retries counted separately; SDK transport retries disabled.']}
        save(output/'summary.json', report)
        (output/'report.md').write_text(render_report(report))
    return report


def render_report(report):
    results = report['results']
    rows = [
        ('Scouting duration, including failures (s)', 'scout_generation_s'),
        ('Model attempts', 'scout_model_attempts'),
        ('Schema retries', 'schema_retries'),
        ('Validation failures', 'validation_failures'),
        ('JSON-format retries', 'format_retries'),
        ('Failed scout units', 'failed_scout_units'),
        ('Completed scout units', 'completed_scout_units'),
        ('Null scout units', 'null_scout_units'),
        ('Selected themes', 'selected_themes'),
        ('Distinct stories', 'distinct_stories'),
        ('Distinct angles (exact text)', 'distinct_angles'),
        ('Writer duration (s)', 'writer_generation_s'),
        ('Writer failures', 'writer_failures'),
        ('Draft cards', 'cards'),
        ('Distinct draft texts', 'distinct_card_texts'),
    ]
    lines = ['# Scout comparison', '', f"Run status: {report['status']}.", '',
             '| Measure | Full pool | Small batches |', '| --- | ---: | ---: |']
    for label, key in rows:
        lines.append(f"| {label} | {results['full_pool'][key]} | {results['batches'][key]} |")
    for key in ('min', 'median', 'max', 'total'):
        lines.append(f"| Request characters ({key}) | {results['full_pool']['request_chars'][key]} | {results['batches']['request_chars'][key]} |")
    lines.extend(['', 'Request sizes are measured per logical scout attempt (system plus user); '
                  'internal JSON-format retry suffixes are not included.', '',
                  'Failed units and completed units differ in size: one full-pool unit can select '
                  'several themes, while one batch unit selects at most one.', '',
                  'These are local drafts, with no publication. Existing admin approval is the '
                  'human quality review path.', ''])
    lines.extend('- ' + limit for limit in report['limits'])
    return '\n'.join(lines) + '\n'
