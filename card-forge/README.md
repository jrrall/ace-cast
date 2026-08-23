# Card Forge

A standalone, multi-persona LLM agent chain that fetches trends, writes
MadLad-style cards, self-critiques / moderates / dedupes them, and POSTs the
survivors as **`pending`** to the [ace-cast](../ace-cast) content API. A human
approves ~10–20/day from the game's `/admin/content` review list; only approved
cards ever reach gameplay.

**Today it is run by hand, from a workstation, against the live game.** There is
no scheduler: you run it when you want cards, and every card still waits for your
approval before it can be dealt. Scheduling is a later decision, once the output
is good enough to trust unattended.

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

Start with `--dry-run` — it exercises the whole chain and every real LLM call,
but POSTs nothing, so you can judge card quality before anything reaches the
review queue.

`CONTENT_API_URL` points at the **live game**, so a real run puts real cards in
the real `/admin/content` queue. They are inert until you approve them, and a
bad batch is cleaned up by denying it (or `DELETE /api/content/cards/:id`, which
only works while a card is still `pending`).

The run **fails closed**: any stage exception → non-zero exit and nothing
partial is submitted. It prints a summary line: themes + generated / edited /
moderated / deduped / assembled / submitted counts.

## Configuration

All settings come from the environment (or `.env`). See `.env.example` for the
full list. Key secrets:

- `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` — the OpenAI-compatible gateway.
- `CONTENT_API_URL` / `CONTENT_API_TOKEN` — the ace-cast content API.
  `CONTENT_API_URL` is the live game (e.g. `https://unholy.cards`).
  `CONTENT_API_TOKEN` should be a **service token** minted on the game side
  (`npm run token:create -- --client card-forge`), which starts with `ct_live_`
  and can be revoked on its own without disturbing any other client. The game's
  legacy shared `CONTENT_API_TOKEN` also still works.
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

- **Scheduling.** Runs are manual for now; `forge.py` already exits non-zero on
  failure, so it can be scheduled unchanged once the output earns it.
- Rate-limiting the POST endpoint is deferred (`maxBatch` bounds a single POST
  to 50 cards, but not the number of POSTs). This matters more now that the
  endpoint takes writes from the open internet: a leaked service token could
  flood the review queue. Revoking that token is the mitigation until a limiter
  exists — `npm run token:revoke -- --client <id>` on the game side.
- Embedding-based near-dup detection (current dedupe is normalised-text exact
  match, layered under the server's authoritative `(pack_id, text)` dedupe).
- Multi-source feed expansion beyond the MVP two.
