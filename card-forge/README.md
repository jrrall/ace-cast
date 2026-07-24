# Card Forge

A standalone, cron-driven, multi-persona LLM agent chain that fetches trends,
writes MadLad-style cards, self-critiques / moderates / dedupes them, and POSTs
the survivors as **`pending`** to the [ace-cast](../ace-cast) content API. A human
approves ~10–20/day from the game's `/admin/content` review list; only approved
cards ever reach gameplay.

Card Forge is **fully decoupled** from the game. It talks to it over HTTP only —
never the database, files, or internal modules. The content API is the sole
contract.

## The five personas

Each persona is one LLM call with a typed pydantic input→output contract, so it
is independently unit-testable with a mocked LLM. The pipeline emits one
structured log entry per persona, so a run's five distinct calls are observable.

| # | Persona | In → Out | Job |
|---|---------|----------|-----|
| 1 | **Trendscout** | feeds → `[Theme]` | Fetch from a curated source allowlist; distil untrusted feed titles into themes. |
| 2 | **Writer** | `Theme` → `[CardCandidate]` | Write prompts (with the `____` blank) and answers per theme. |
| 3 | **Editor** | `[CardCandidate]` → `[CardCandidate]` | Cull broken/unfunny/dupe cards; tighten wording. |
| 4 | **Moderator** | `[CardCandidate]` → `[ModeratedCard]` | Assign maturity 0–3, cap at the pack ceiling, drop out-of-policy + deny-listed. |
| 5 | **Curator** | `[ModeratedCard]` → `SubmitBatch` | Fetch the existing corpus (incl. denied), drop near-dups, rank/select 10–20. |

Then `client.py` POSTs the batch; the server re-validates, dedupes on
`(pack_id, text)`, and stores everything as `pending`.

## Why the OpenAI SDK (not pydantic-ai)

The stage contracts are pydantic models either way. The chain itself is a fixed,
linear sequence of **exactly one LLM call per persona** — there is no tool-use
loop, planner, or dynamic control flow for an agent framework to manage. Wrapping
each step in a pydantic-ai `Agent` would add its own run/retry/tool machinery and
make "one mockable call per persona" and the "5 distinct calls observable"
guarantee harder to assert. A single thin `LLMClient.complete_json` boundary
(pointed at the OpenAI-compatible litellm gateway) keeps every persona a pure
typed-in → typed-out function that a test mocks in one line, which is exactly what
the plan's per-persona isolation requires. So: `openai` SDK for transport,
`pydantic` for every stage boundary.

## Setup

Requires Python 3.13 and [`uv`](https://docs.astral.sh/uv/).

```bash
cd card-forge
uv sync --extra dev      # create the venv and install deps + test extras
cp .env.example .env     # then fill in LLM + content API secrets
```

## Run

```bash
uv run python forge.py --dry-run   # run the full chain, print the batch, POST nothing
uv run python forge.py             # run and submit pending cards to the content API
```

The entrypoint is cron-friendly and **fails closed**: any stage exception →
non-zero exit and nothing partial is submitted. See `crontab.example` for a daily
schedule. The run prints a summary line: themes + generated / edited / moderated /
deduped / assembled / submitted counts.

## Configuration

All settings come from the environment (or `.env`). See `.env.example` for the
full list. Key secrets:

- `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` — the OpenAI-compatible gateway.
- `CONTENT_API_URL` / `CONTENT_API_TOKEN` — the ace-cast content API. The token
  must match the game's `CONTENT_API_TOKEN` (document it in the game's
  `deploy/linode/` env alongside `ADMIN_TOKEN`).
- `FEED_ALLOWLIST` — comma-separated feed URLs.
- `PACK_SLUG` / `MATURITY_MAX` — target pack and its maturity ceiling.

## Feed sources, ToS, and safety

Trendscout fetches **only** the URLs in `FEED_ALLOWLIST` (MVP default: one
subreddit JSON feed + one news RSS). Arbitrary scraped URLs are never used.

**You are responsible for the Terms of Service and legality of every feed source
you configure.** Reddit and news outlets have their own API/usage terms; review
them before enabling a source in production.

All fetched feed text is treated as **untrusted data**. It is injected into
downstream prompts only inside explicit `<<<FEED_DATA>>>` delimiters, never as
instructions, and the Moderator applies an independent deny-list so a
prompt-injected model still cannot push policy-violating content into the batch.

## Tests

```bash
uv run pytest
```

Covers each persona in isolation (mocked LLM, typed in → typed out), a dry-run
all-valid-batch check, prompt-injection defence, dedupe (including denied cards),
and fail-closed behaviour. No test touches the network or the real gateway.

## Deferrals / follow-ups

- Rate-limiting the POST endpoint is deferred to the server (`maxBatch` bounds
  per-request size on a trusted machine token).
- Embedding-based near-dup detection (current dedupe is normalised-text exact
  match, layered under the server's authoritative `(pack_id, text)` dedupe).
- Multi-source feed expansion beyond the MVP two.
