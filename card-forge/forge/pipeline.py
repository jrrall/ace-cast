"""Pipeline orchestration.

Runs the five personas in order, emits one structured log entry per persona
("5 distinct calls observable"), and fails closed: any stage exception
propagates so the entrypoint exits non-zero and NOTHING is submitted. In
``dry_run`` the assembled batch is returned/printed but never POSTed.
"""

from __future__ import annotations

from collections.abc import Callable

from .client import ContentClient
from .config import Settings
from .feeds import FeedItem
from .llm import LLMClient
from .logging_setup import get_logger, log_stage
from .models import CardCandidate, RunSummary, SubmitBatch
from .personas import Curator, Editor, Moderator, Trendscout, Writer


class Pipeline:
    def __init__(
        self,
        settings: Settings,
        llm: LLMClient,
        content: ContentClient,
        fetch_fn: Callable[[Settings], list[FeedItem]] | None = None,
    ) -> None:
        self.settings = settings
        self.llm = llm
        self.content = content
        self.fetch_fn = fetch_fn
        self.log = get_logger()

    def build_batch(self, summary: RunSummary) -> SubmitBatch:
        """Run Trendscout -> Curator and return the assembled batch."""
        # 1. Trendscout
        themes = Trendscout(self.llm, self.settings, self.fetch_fn).run()
        summary.themes = len(themes)
        log_stage(self.log, Trendscout.name, themes=len(themes))

        # 2. Writer (one LLM call per theme)
        generated: list[CardCandidate] = []
        for theme in themes:
            generated.extend(Writer(self.llm, self.settings).run(theme))
        summary.generated = len(generated)
        log_stage(self.log, Writer.name, generated=len(generated))

        # 3. Editor
        edited = Editor(self.llm, self.settings).run(generated)
        summary.edited = len(edited)
        log_stage(self.log, Editor.name, edited=len(edited))

        # 4. Moderator
        moderated = Moderator(self.llm, self.settings).run(edited)
        summary.moderated = len(moderated)
        log_stage(self.log, Moderator.name, moderated=len(moderated))

        # 5. Curator
        batch = Curator(self.llm, self.content, self.settings).run(moderated)
        summary.assembled = len(batch.cards)
        summary.deduped = len(moderated) - len(batch.cards)
        log_stage(
            self.log,
            Curator.name,
            assembled=len(batch.cards),
            deduped=summary.deduped,
        )
        return batch

    def run(self, *, dry_run: bool = False) -> tuple[RunSummary, SubmitBatch]:
        summary = RunSummary(dry_run=dry_run)
        batch = self.build_batch(summary)

        if dry_run:
            self.log.info(
                "dry-run: not submitting",
                extra={"extra_fields": {"cards": len(batch.cards)}},
            )
            return summary, batch

        if not batch.cards:
            self.log.info("nothing to submit", extra={"extra_fields": {"cards": 0}})
            return summary, batch

        result = self.content.submit(batch)
        summary.submitted = len(result.created)
        summary.skipped = result.skipped
        summary.rejected = len(result.rejected)
        self.log.info(
            "submitted",
            extra={
                "extra_fields": {
                    "created": summary.submitted,
                    "skipped": summary.skipped,
                    "rejected": summary.rejected,
                }
            },
        )
        return summary, batch
