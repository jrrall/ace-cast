"""OpenAI-compatible LLM client.

Thin wrapper around the ``openai`` SDK pointed at the litellm gateway
(``LLM_BASE_URL``, ``/v1/chat/completions``). Exposing a single
``complete_json`` method makes each persona a pure typed-in -> typed-out unit
that a test can mock with one line.
"""

from __future__ import annotations

import json
import time
from typing import Any

from openai import OpenAI, APITimeoutError

from .call_context import CALL_CONTEXT

from .config import Settings
from .logging_setup import get_logger

LOG = get_logger("forge.llm")


class LLMError(RuntimeError):
    """Raised when the LLM call fails or returns unparseable output."""


class _TimeoutResponseError(LLMError):
    """A transport timeout eligible for a separate bounded retry."""


class _JSONResponseError(LLMError):
    """Only invalid or truncated JSON is eligible for a format retry."""


def _extract_json(text: str) -> Any:
    """Best-effort extraction of a JSON value from a model response.

    Handles bare JSON, ```json fenced blocks, and leading/trailing prose.
    """
    if text is None:
        raise LLMError("empty LLM response")
    s = text.strip()
    if s.startswith("```"):
        # strip a fenced code block (```json ... ``` or ``` ... ```)
        s = s.split("```", 2)
        s = s[1] if len(s) >= 2 else text
        if s.lstrip().lower().startswith("json"):
            s = s.lstrip()[4:]
        s = s.strip().rstrip("`").strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError as exc:
        # Decode the first outer JSON value, never a nested array salvaged from
        # an incomplete object (which could silently publish a partial batch).
        starts = [pos for ch in ("{", "[") if (pos := s.find(ch)) >= 0]
        if starts:
            try:
                value, _ = json.JSONDecoder().raw_decode(s[min(starts):])
                return value
            except json.JSONDecodeError:
                pass
        raise LLMError(
            f"invalid JSON ({len(text)} response characters): "
            f"{exc.msg} at line {exc.lineno}, column {exc.colno}"
        ) from exc



class LLMClient:
    """JSON completion boundary with one bounded format retry by default."""

    def __init__(self, settings: Settings, client: OpenAI | None = None) -> None:
        self.settings = settings
        self.model = settings.llm_model
        base_url = settings.llm_base_url.rstrip("/")
        if not base_url.endswith("/v1"):
            base_url += "/v1"
        self._client = client or OpenAI(
            base_url=base_url,
            api_key=settings.llm_api_key or "not-set",
            timeout=settings.llm_timeout,
            # Explicit, because the SDK default of 2 is invisible: a stuck call
            # costs (1 + max_retries) * llm_timeout before it ever raises.
            max_retries=settings.llm_max_retries,
        )

    def complete_json(self, *, system: str, user: str, temperature: float = 0.8) -> Any:
        """Send one chat completion and return parsed JSON.

        Raises ``LLMError`` on transport failure or unparseable output so the
        pipeline can fail closed.
        """
        self.last_call_source = 'generation'
        self.last_call_stats = {'model_attempts': 0, 'format_retries': 0}
        format_attempt = timeout_attempt = 0
        while True:
            self.last_call_stats['model_attempts'] += 1
            try:
                return self._complete_json_once(
                    system=system, user=user, temperature=temperature if format_attempt == 0 else 0.0,
                    format_retry=format_attempt > 0,
                )
            except _TimeoutResponseError:
                if self.settings.llm_max_retries or timeout_attempt >= self.settings.llm_timeout_retries:
                    raise
                timeout_attempt += 1
                LOG.warning("llm.timeout_retry", extra={"extra_fields": {
                    **CALL_CONTEXT.get(), "model": self.model, "attempt": timeout_attempt,
                    "delay_s": 2,
                }})
                time.sleep(2)
            except _JSONResponseError as exc:
                if format_attempt >= self.settings.llm_json_retries:
                    raise LLMError(f"LLM JSON failed after {format_attempt + 1} attempts: {exc}") from exc
                format_attempt += 1
                self.last_call_stats['format_retries'] += 1
                LOG.warning("llm.json_retry", extra={"extra_fields": {
                    **CALL_CONTEXT.get(), "model": self.model, "attempt": format_attempt, "error": str(exc),
                }})

    def _complete_json_once(self, *, system: str, user: str, temperature: float,
                            format_retry: bool) -> Any:
        context = {"phase": "unspecified", "max_tokens": 4096, **CALL_CONTEXT.get()}
        kwargs: dict[str, Any] = {"max_tokens": context["max_tokens"]}
        if self.settings.llm_reasoning_effort:
            kwargs["reasoning_effort"] = self.settings.llm_reasoning_effort
        if format_retry:
            system += (
                "\nThe previous response was not complete valid JSON. Generate the full "
                "response again, more concisely. Return only one complete JSON object, "
                "with double-quoted keys and strings and all brackets closed. "
                "Use valid JSON escapes: an apostrophe needs no escaping. "
                "Do not include markdown, commentary, or backslash line continuations."
            )
        LOG.info("llm.call_started", extra={"extra_fields": {**context, "model": self.model,
            "input_chars": len(system) + len(user)}})
        started = time.monotonic()
        try:
            resp = self._client.chat.completions.create(
                model=self.model,
                temperature=temperature,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                response_format={"type": "json_object"},
                **kwargs,
            )
        except Exception as exc:  # noqa: BLE001 - normalise all transport errors
            # Log before raising: a persona that makes several calls would
            # otherwise fail with no record of how long it waited or how far it
            # got. `elapsed` covers every SDK-internal retry.
            LOG.error(
                "llm.call_failed",
                extra={"extra_fields": {
                    **context, "model": self.model,
                    "elapsed_s": round(time.monotonic() - started, 1),
                    "max_retries": self.settings.llm_max_retries,
                    "error": str(exc),
                }},
            )
            error = _TimeoutResponseError if isinstance(exc, APITimeoutError) else LLMError
            raise error(f"LLM request failed: {exc}") from exc
        LOG.info(
            "llm.call",
            extra={"extra_fields": {
                **context, "model": self.model,
                "prompt_tokens": getattr(getattr(resp, "usage", None), "prompt_tokens", None),
                "completion_tokens": getattr(getattr(resp, "usage", None), "completion_tokens", None),
                "elapsed_s": round(time.monotonic() - started, 1),
                "finish_reason": resp.choices[0].finish_reason if resp.choices else None,
            }},
        )
        try:
            choice = resp.choices[0]
            content = choice.message.content
        except (AttributeError, IndexError) as exc:
            raise LLMError(f"malformed LLM response: {exc}") from exc
        if choice.finish_reason == "length":
            raise _JSONResponseError("LLM output truncated (finish_reason=length)")
        if choice.finish_reason != "stop":
            raise LLMError(f"LLM completion did not finish normally: {choice.finish_reason}")
        try:
            return _extract_json(content)
        except LLMError as exc:
            raise _JSONResponseError(str(exc)) from exc
