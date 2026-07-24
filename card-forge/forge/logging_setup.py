"""Structured JSON logging.

One structured log entry is emitted per persona stage so a run makes its five
distinct persona calls observable in the logs.
"""

from __future__ import annotations

import json
import logging
import sys
from typing import Any


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "msg": record.getMessage(),
        }
        extra = getattr(record, "extra_fields", None)
        if extra:
            payload.update(extra)
        return json.dumps(payload, ensure_ascii=False)


def get_logger(name: str = "forge") -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False
    return logger


def log_stage(logger: logging.Logger, persona: str, **fields: Any) -> None:
    """Emit exactly one structured entry for a persona stage."""
    logger.info(
        f"persona.{persona}",
        extra={"extra_fields": {"persona": persona, "stage": True, **fields}},
    )
