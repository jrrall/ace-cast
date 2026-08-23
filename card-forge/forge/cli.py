"""Command-line entrypoint. Non-zero exit on any stage failure, nothing partial."""

from __future__ import annotations

import argparse
import json
import sys

from .client import ContentClient
from .config import load_settings
from .llm import LLMClient
from .logging_setup import get_logger
from .pipeline import Pipeline


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="card-forge",
        description="Generate MadLad cards via a 5-persona LLM chain and submit "
        "them as pending to the ace-cast content API.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run the full chain and print the assembled batch WITHOUT POSTing.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    log = get_logger()
    settings = load_settings()

    llm = LLMClient(settings)
    content = ContentClient(settings)
    pipeline = Pipeline(settings, llm, content)

    try:
        summary, batch = pipeline.run(dry_run=args.dry_run)
    except Exception as exc:  # noqa: BLE001 - fail closed on ANY stage error
        log.error(
            "run failed; nothing submitted",
            extra={"extra_fields": {"error": str(exc), "error_type": type(exc).__name__}},
        )
        return 1

    log.info("run summary", extra={"extra_fields": {"summary": summary.as_line()}})

    if args.dry_run:
        print(json.dumps(batch.payload(), indent=2, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    sys.exit(main())
