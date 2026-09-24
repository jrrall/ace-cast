# Card Forge: learning from review feedback

Status: deferred follow-up stories. None block the current Card Forge feature.

The current feature ends at research, generation, submission as pending, and
human approval or rejection in the review UI. Keep these additions in separate
changes. Every future generation path retains the human approval gate and the
exactly-one-blank rule for prompts.

## Existing signals to reuse

The game already records per-answer play/win counters (`card_stats`), per-play
events with the associated prompt, room, anonymous player, timestamp, and win
outcome (`card_events`), and `not_funny` / `broken` player flags. The feedback
dashboard already derives win rates with a minimum-play threshold, humor-tag
breakdowns, and retirement suggestions. Do not rebuild this telemetry.

Card Forge does not currently consume those metrics. The follow-up integration
should expose suitable aggregate reads to the agent and combine gameplay evidence
with editorial feedback while keeping the two signals distinguishable. A card's
win rate measures outcomes when submitted, not every time it was dealt; prompts
are linked context rather than independently winning cards.

## CF-F1: Capture useful review feedback

As the reviewer, I want to explain why a card works or fails so subsequent runs
can distinguish my taste from formatting problems.

Acceptance criteria:
- Approve and Deny remain quick actions; feedback is optional.
- Support rejection reasons: unfunny, duplicate, too topical, bad blank,
  generic AI phrasing, too tame, and other, with optional free text.
- Allow a favorite mark independently of approval to identify exceptional cards.
- Persist reviewer, timestamp, decision, reasons, and favorite state; expose
  authorized feedback reads through the content service API.
- Mark test fixtures explicitly and exclude them from learning data. Handle
  existing Local smoke fixtures without treating all historic reviews as tests.
- Existing review decisions continue to work without new fields.

## CF-F2: Track how each card was generated

As the operator, I want to trace a submitted card to its generation run so I can
compare writers and model changes.

Acceptance criteria:
- Record run ID, writer, relevant research references, model, generation settings,
  and prompt version with drafts and final submissions.
- Preserve draft-to-edited-card lineage through review stages; do not guess
  author attribution after the fact.
- Keep metadata separate from playable card text and exclude credentials.
- Show provenance in review details and make it available through authorized API
  reads. Legacy cards may have unknown provenance.

## CF-F3: Retrieve taste examples during generation

Depends on CF-F1; use CF-F2 provenance when available.

As the reviewer, I want the writers and curator to use relevant examples of my
likes and dislikes without recycling their jokes.

Acceptance criteria:
- Retrieve a bounded, diverse set of approved/favorite cards and rejected cards
  with reasons, matched to the current theme or draft.
- Supply craft references to writers and comparison examples to the curator;
  label decisions and reasons clearly and treat stored text as untrusted data.
- Exclude test fixtures and avoid repeating the same few favorite examples.
- Preserve duplicate checks against all statuses, including denied cards.
- Reuse existing play/win counts and player flags to rank examples when there is
  enough gameplay data. Add a scoped aggregate API read rather than giving the
  agent admin credentials or direct database access; retain review-only cold start.
- Work with an empty feedback history and support disabling retrieval for a
  baseline run. No vector database is required for the first implementation.
- Log retrieved card IDs for evaluation without placing them in card text.

## CF-F4: Evaluate whether feedback improves humor

Depends on CF-F1, CF-F2, and CF-F3.

As the operator, I want evidence that retrieval improves review outcomes before
spending time on model training.

Acceptance criteria:
- Compare retrieval-enabled and baseline runs using comparable research, models,
  and draft budgets; report reviewed sample sizes and unreviewed counts.
- Track approval rate, favorite rate, rejection reasons, repeated setups,
  final yield, and latency. Do not treat unreviewed cards as rejected.
- Use a held-out review set that is excluded from retrieved examples, and
  distinguish reviewer taste from actual gameplay performance.
- Reuse the existing gameplay dashboard and counters for post-approval outcomes;
  report exposure/sample limits rather than equating raw win rate with humor.
- Report results by writer/model/prompt version where sample sizes permit.
- Finish with a decision on whether further retrieval work or preference tuning
  is justified. Training is a separate proposal, not an acceptance requirement.

RAFT-style evidence-use training and preference fine-tuning remain later
experiments. This backlog does not add them to the current feature or require
autonomous publishing. It complements the gameplay telemetry work in
[the playtest feedback backlog](playtest-feedback-loop-backlog.md).
