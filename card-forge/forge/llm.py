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

from openai import OpenAI

from .config import Settings
from .logging_setup import get_logger

LOG = get_logger("forge.llm")


class LLMError(RuntimeError):
    """Raised when the LLM call fails or returns unparseable output."""


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
    except json.JSONDecodeError:
        # fall back to the outermost bracketed region
        for open_ch, close_ch in (("[", "]"), ("{", "}")):
            start = s.find(open_ch)
            end = s.rfind(close_ch)
            if start != -1 and end > start:
                try:
                    return json.loads(s[start : end + 1])
                except json.JSONDecodeError:
                    continue
        raise LLMError(f"could not parse JSON from LLM response: {text[:200]!r}")


class LLMClient:
    """Single-call boundary for all personas."""

    def __init__(self, settings: Settings, client: OpenAI | None = None) -> None:
        self.settings = settings
        self.model = settings.llm_model
        self._client = client or OpenAI(
            base_url=settings.llm_base_url.rstrip("/") + "/v1",
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
        kwargs: dict[str, Any] = {}
        if self.settings.llm_reasoning_effort:
            kwargs["reasoning_effort"] = self.settings.llm_reasoning_effort
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
                    "model": self.model,
                    "elapsed_s": round(time.monotonic() - started, 1),
                    "max_retries": self.settings.llm_max_retries,
                    "error": str(exc),
                }},
            )
            raise LLMError(f"LLM request failed: {exc}") from exc
        LOG.info(
            "llm.call",
            extra={"extra_fields": {
                "model": self.model,
                "elapsed_s": round(time.monotonic() - started, 1),
            }},
        )
        try:
            content = resp.choices[0].message.content
        except (AttributeError, IndexError) as exc:
            raise LLMError(f"malformed LLM response: {exc}") from exc
        return _extract_json(content)
