"""Pipeline orchestration.

Runs research, six independent writers, and review stages. Logs each writer
separately and fails closed: any stage exception
propagates so the entrypoint exits non-zero and NOTHING is submitted. In
``dry_run`` the assembled batch is returned/printed but never POSTed.
"""

from __future__ import annotations

from collections.abc import Callable

from .balance import type_counts
from .client import ContentClient
from .config import Settings
from .feeds import FeedItem
from .llm import LLMClient
from .logging_setup import get_logger, log_stage
from .models import CardCandidate, RunSummary, SubmitBatch
from .personas import Curator, Editor, Moderator, Trendscout, writing_team


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
        scout = Trendscout(self.llm, self.settings, self.fetch_fn)
        themes = scout.run()
        summary.themes = len(themes)
        log_stage(self.log, Trendscout.name, themes=len(themes))

        # Each writer sees identical research, never the other writer's drafts.
        # Sequential calls avoid competing for memory on a local LLM server.
        generated: list[CardCandidate] = []
        if self.settings.comedy_loop:
            from .comedy_room import ComedyRoom
            generated = ComedyRoom(self.llm, self.settings).run(themes)
        else:
            for writer in writing_team(self.llm, self.settings):
                writer_cards: list[CardCandidate] = []
                for theme in themes:
                    drafts = [c.model_copy(update={"generation_route": "writer"}) for c in writer.run(theme)]
                    generated.extend(drafts)
                    writer_cards.extend(drafts)
                log_stage(self.log, writer.name, generated=len(writer_cards), **type_counts(writer_cards))
        from .source_finds import find_cards
        finds = find_cards(self.llm, scout.fetched, self.settings.source_finds_max)
        summary.generated = len(generated) + len(finds)

        # 3. Editor
        edited = Editor(self.llm, self.settings).run(generated)
        # Found phrases already are cards: preserve their exact wording for judgment.
        edited.extend(finds)
        from .tighten import tighten_cards
        edited = tighten_cards(self.llm, edited)
        summary.edited = len(edited)
        log_stage(self.log, Editor.name, edited=len(edited), **type_counts(edited))

        # 4. Moderator
        moderated = Moderator(self.llm, self.settings).run(edited)
        summary.moderated = len(moderated)
        log_stage(self.log, Moderator.name, moderated=len(moderated), **type_counts(moderated))

        # 5. Curator
        batch = Curator(self.llm, self.content, self.settings).run(moderated)
        summary.assembled = len(batch.cards)
        summary.deduped = len(moderated) - len(batch.cards)
        log_stage(
            self.log,
            Curator.name,
            assembled=len(batch.cards),
            **type_counts(batch.cards),
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
