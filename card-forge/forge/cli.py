"""Command-line entrypoint. Non-zero exit on any stage failure, nothing partial."""

from __future__ import annotations

import argparse
from contextlib import nullcontext

from .checkpoint import Checkpoint
import json
import sys

from .client import ContentClient
from .config import load_settings
from .llm import LLMClient
from .logging_setup import get_logger
from .pipeline import Pipeline
from .rewrite import RewriteCompatibilityError, rewrite_denied


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="card-forge",
        description="Generate MadLad cards via a multi-persona LLM chain and submit "
        "them as pending to the ace-cast content API.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run the full chain and print the assembled batch WITHOUT POSTing.",
    )
    parser.add_argument("--run-dir", help="Persist resumable JSON checkpoints in this directory")
    parser.add_argument("--resume", action="store_true", help="Resume an existing --run-dir")
    parser.add_argument('--rewrite-denied', action='store_true',
                        help='Rewrite commented rejections with their original personas; submit directly as pending')
    args = parser.parse_args(argv)
    if args.rewrite_denied and (args.run_dir or args.resume):
        parser.error('--rewrite-denied cannot be combined with --run-dir or --resume')
    if args.resume and not args.run_dir:
        parser.error("--resume requires --run-dir")
    return args


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    log = get_logger()
    settings = load_settings()

    llm = LLMClient(settings)
    content = ContentClient(settings)

    try:
        if args.rewrite_denied:
            summary, batch = rewrite_denied(settings, llm, content, dry_run=args.dry_run)
        else:
            summary, batch = _generate(args, settings, llm, content)
    except RewriteCompatibilityError as exc:
        log.error(str(exc))
        return 1
    except Exception as exc:  # noqa: BLE001 - fail closed on ANY stage error
        log.error(
            "run failed; if submission was attempted, check the review queue before retrying",
            extra={"extra_fields": {"error": str(exc), "error_type": type(exc).__name__}},
        )
        return 1

    log.info("run summary", extra={"extra_fields": {"summary": summary.as_line()}})
    if args.dry_run:
        print(json.dumps(batch.payload(), indent=2, ensure_ascii=False))
    return 0


def _generate(args, settings, llm, content):
    context = Checkpoint(args.run_dir, settings, resume=args.resume) if args.run_dir else nullcontext()
    with context as checkpoint:
        pipeline = Pipeline(settings, llm, content, checkpoint=checkpoint)
        return pipeline.run(dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
