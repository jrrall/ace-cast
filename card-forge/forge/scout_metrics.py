"""Scout attempt telemetry, separate from model and checkpoint replay timing."""
import json
import time

from .logging_setup import get_logger


def scout_attempt(llm, writer, *, protocol, batch, stories, payload, system, attempt, validate):
    user = json.dumps(payload, ensure_ascii=False)
    fields = {'persona': writer.name, 'protocol': protocol, 'batch': batch,
              'story_count': len(stories), 'input_chars': len(system) + len(user),
              'user_chars': len(user), 'attempt': attempt}
    started = time.monotonic()
    validation_failed, error_type, selected_count = False, None, None
    try:
        data = llm.complete_json(system=system, user=user)
        try:
            result = validate(data)
        except ValueError:
            validation_failed = True
            raise
        selected_count = len(result) if isinstance(result, list) else int(result is not None)
        return data, result
    except BaseException as exc:
        error_type = type(exc).__name__
        raise
    finally:
        get_logger().info('scout.attempt', extra={'extra_fields': {
            **fields, 'duration_s': round(time.monotonic() - started, 6),
            'source': getattr(llm, 'last_call_source', 'generation'),
            **getattr(llm, 'last_call_stats', {'model_attempts': 1, 'format_retries': 0}),
            'validation_failed': validation_failed, 'error_type': error_type,
            'selected': None if selected_count is None else selected_count > 0,
            'selected_count': selected_count,
        }})


def scout_reused(writer, batch, stories, theme, *, protocol='batches-v1'):
    selected_count = len(theme) if isinstance(theme, list) else int(theme is not None)
    get_logger().info('scout.reused', extra={'extra_fields': {
        'persona': writer.name, 'protocol': protocol, 'batch': batch,
        'story_count': len(stories), 'input_chars': 0, 'user_chars': 0,
        'attempt': 0, 'duration_s': 0, 'source': 'checkpoint',
        'model_attempts': 0, 'format_retries': 0, 'validation_failed': False,
        'error_type': None, 'selected': selected_count > 0,
        'selected_count': selected_count,
    }})
