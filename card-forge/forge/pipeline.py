"""Pipeline orchestration.

Runs research, seven independent writers, and review stages. Logs each writer
separately and fails closed: any stage exception
propagates so the entrypoint exits non-zero and NOTHING is submitted. In
``dry_run`` the assembled batch is returned/printed but never POSTed.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict

from .balance import type_counts
from .client import ContentClient
from .config import Settings
from .feeds import FeedItem
from .llm import LLMClient
from .logging_setup import get_logger, log_stage
from .models import CardCandidate, RunSummary, SubmitBatch, Theme
from .personas import Curator, Editor, Moderator, Trendscout, writing_team


class Pipeline:
    def __init__(
        self,
        settings: Settings,
        llm: LLMClient,
        content: ContentClient,
        fetch_fn: Callable[[Settings], list[FeedItem]] | None = None,
        checkpoint=None,
    ) -> None:
        self.settings = settings
        self.writer_names = checkpoint.writer_names if checkpoint else None
        self.personas = checkpoint.personas if checkpoint else None
        self.checkpoint = checkpoint
        self.llm = checkpoint.wrap(llm) if checkpoint else llm
        self.content = content
        self.fetch_fn = fetch_fn
        self.log = get_logger()

    def build_batch(self, summary: RunSummary) -> SubmitBatch:
        """Run Trendscout -> Curator and return the assembled batch."""
        scout = Trendscout(self.llm, self.settings, self.fetch_fn)
        writers = writing_team(self.llm, self.settings, names=self.writer_names, definitions=self.personas)
        persona_scout = self.checkpoint.persona_scout if self.checkpoint else self.settings.persona_scout
        research = self.checkpoint.read("research") if self.checkpoint else None
        structured = not self.checkpoint or self.checkpoint.scout_protocol in ("stories-v1", "batches-v1")
        if persona_scout:
            if research is None:
                items = scout.collect(distinct_stories=structured)
                from .stories import stories_from_items
                stories = stories_from_items(items)
                if self.checkpoint:
                    self.checkpoint.write("research", {
                        "items": [asdict(item) for item in items],
                        "stories": stories,
                        "fetched": [asdict(item) for item in scout.fetched],
                    })
            else:
                items = [FeedItem(**item) for item in research["items"]]
                scout.fetched = [FeedItem(**item) for item in research["fetched"]]
            if research is not None and structured:
                stories = research["stories"]
            if not self.checkpoint or self.checkpoint.scout_protocol == "batches-v1":
                from .scout_batches import scout_team
                by_writer = scout_team(self.llm, self.settings, writers, stories, self.checkpoint)
            else:
                by_writer = {}
                for writer in writers:
                    key = "scouts/" + writer.name
                    saved = self.checkpoint.read(key) if self.checkpoint else None
                    if saved is None:
                        themes = (scout.for_stories(writer, stories) if structured
                                  else scout.for_writer(writer, items))
                        if self.checkpoint:
                            self.checkpoint.write(key, {
                                "writer": writer.name, "persona_version": writer.definition.version,
                                "themes": [t.model_dump(mode="json") for t in themes],
                            })
                    else:
                        themes = [Theme.model_validate(t) for t in saved["themes"]]
                        from .scout_metrics import scout_reused
                        scout_reused(writer, 0, stories if structured else items, themes,
                                     protocol=self.checkpoint.scout_protocol)
                    by_writer[writer.name] = themes
            summary.themes = sum(len(themes) for themes in by_writer.values())
        else:
            # Explicit legacy mode, also retained by older checkpoints.
            if research is None:
                themes = scout.run()
                if self.checkpoint:
                    self.checkpoint.write("research", {
                        "themes": [t.model_dump(mode="json") for t in themes],
                        "fetched": [asdict(item) for item in scout.fetched],
                    })
            else:
                themes = [Theme.model_validate(t) for t in research["themes"]]
                scout.fetched = [FeedItem(**item) for item in research["fetched"]]
            by_writer = {writer.name: themes for writer in writers}
            summary.themes = len(themes)
        log_stage(self.log, Trendscout.name, themes=summary.themes)

        generated: list[CardCandidate] = []
        if self.settings.comedy_loop:
            from .comedy_room import ComedyRoom
            generated = ComedyRoom(self.llm, self.settings, writers=writers).run(by_writer)
        else:
            for writer in writers:
                writer_cards: list[CardCandidate] = []
                for theme in by_writer[writer.name]:
                    drafts = [c.model_copy(update={"generation_route": "writer"}) for c in writer.run(theme)]
                    generated.extend(drafts)
                    writer_cards.extend(drafts)
                log_stage(self.log, writer.name, generated=len(writer_cards), **type_counts(writer_cards))
        from .source_finds import find_cards
        finds = find_cards(self.llm, scout.fetched, self.settings.source_finds_max)
        summary.generated = len(generated) + len(finds)
        self._save_cards("drafts", generated + finds)

        # 3. Editor
        edited = Editor(self.llm, self.settings).run(generated)
        # Found phrases already are cards: preserve their exact wording for judgment.
        edited.extend(finds)
        from .tighten import tighten_cards
        edited = tighten_cards(self.llm, edited)
        self._save_cards("edited", edited)
        summary.edited = len(edited)
        log_stage(self.log, Editor.name, edited=len(edited), **type_counts(edited))

        # 4. Moderator
        moderated = Moderator(self.llm, self.settings).run(edited)
        self._save_cards("moderated", moderated)
        summary.moderated = len(moderated)
        log_stage(self.log, Moderator.name, moderated=len(moderated), **type_counts(moderated))

        # 5. Curator
        batch = Curator(self.llm, self.content, self.settings).run(moderated)
        if self.checkpoint:
            self.checkpoint.write("final", batch.payload())
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

    def _save_cards(self, name, cards):
        if self.checkpoint:
            self.checkpoint.write(name, {"cards": [c.model_dump(mode="json") for c in cards]})

    def run(self, *, dry_run: bool = False) -> tuple[RunSummary, SubmitBatch]:
        summary = RunSummary(dry_run=dry_run)
        submission = self.checkpoint.read("submission") if self.checkpoint else None
        if submission is not None:
            if submission["status"] != "completed":
                raise ValueError("Previous submission outcome is uncertain; inspect the API review queue before retrying")
            # A completed run must not submit again or rebuild against a changed corpus.
            summary = RunSummary.model_validate(submission["summary"])
            summary.dry_run = dry_run
            return summary, SubmitBatch.model_validate(submission["batch"])
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

        if self.checkpoint:
            self.checkpoint.write("submission", {"status": "started", "batch": batch.model_dump(mode="json")})
        result = self.content.submit(batch)
        summary.submitted = len(result.created)
        summary.skipped = result.skipped
        summary.rejected = len(result.rejected)
        if self.checkpoint:
            self.checkpoint.write("submission", {
                "status": "completed", "batch": batch.model_dump(mode="json"),
                "result": result.model_dump(mode="json"), "summary": summary.model_dump(),
            })
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
