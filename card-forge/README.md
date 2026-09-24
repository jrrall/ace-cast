# Card Forge

A standalone, multi-persona LLM agent chain that fetches trends, writes
MadLad-style cards, self-critiques / moderates / dedupes them, and POSTs the
survivors as **`pending`** to the [ace-cast](../README.md) content API. A human
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

Each stage has typed card/theme models and is independently testable with a
mocked LLM. Writer calls the model once per theme; the other stages make at
most one call each and may skip empty inputs. A four-theme run normally makes
eight LLM calls. Logs record stage counts and LLM call start/completion times.

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

The pipeline has a fixed order and needs no tool-use loop or planner. The thin
`LLMClient.complete_json` boundary keeps transport mockable, while pydantic
validates cards and themes. It uses an OpenAI-compatible Chat Completions API,
including Ollama's local endpoint.

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
review queue. It still reads the game's corpus for dedupe.

For a local Ollama smoke test with canned feeds and an empty corpus (no game
server or credentials needed):

```bash
LLM_BASE_URL=http://localhost:11434/v1 LLM_API_KEY=ollama \
LLM_MODEL=huihui_ai/qwen3-abliterated:8b LLM_REASONING_EFFORT=none \
uv run python scripts/live_smoke.py
```

Use an installed model from `ollama list`. A server root URL is also accepted;
`/v1` is appended only when absent. Reasoning settings are omitted unless set.
See [Ollama's compatibility documentation](https://docs.ollama.com/api/openai-compatibility).


`CONTENT_API_URL` points at the **live game**, so a real run puts real cards in
the real `/admin/content` queue. They are inert until you approve them, and a
bad batch is cleaned up by denying it (or `DELETE /api/content/cards/:id`, which
only works while a card is still `pending`).

Generation-stage exceptions abort before submission. A submission timeout has
an unknown outcome: the server may already have accepted the batch; check the
review queue before retrying. It prints a summary line: themes + generated / edited /
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

Trendscout fetches **only** the URLs in `FEED_ALLOWLIST` (default: Know Your
Meme + BBC News RSS). Arbitrary scraped URLs are never used.

Reddit is not in the default list and cannot easily be: it returns an HTML
interstitial (403) to unauthenticated clients on both `.json` and `.rss`, no
matter what User-Agent is sent — only a signed-in browser receives data. Use
Reddit's OAuth API if you want it as a source.

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

## Current limits

The same model writes and judges its output; five stages do not constitute five
independent opinions. Structurally valid output can still be bland or combine
poorly in gameplay. Review random prompt/answer pairings before approving a batch.

Corpus pagination requires the updated game server. An older server returns a
single page, so preflight dedupe is incomplete until the server is updated.
Server dedupe currently checks before inserting and is not protected by a unique
normalized-text constraint: simultaneous identical submissions can race. Batch
insertion is transactional, but this does not make concurrent dedupe atomic.
Service credentials identify requests, but the submitting client is not yet
persisted on each card; retained token records alone cannot attribute old cards.

## Docker container

This is a one-shot job: it generates one batch, submits pending cards, and exits.
The game and Ollama run separately. No port or database volume is needed.

Build from the repository root:

```bash
docker build -t card-forge:local card-forge
cp card-forge/.env.example card-forge/.env
```

Edit `.env`: set `CONTENT_API_TOKEN` to the game's service token and set the LLM
endpoint/model. For Ollama on the host, use
`LLM_BASE_URL=http://host.docker.internal:11434/v1`; `localhost` inside the
container refers to the container itself. For an LLM on another machine, use its
reachable LAN URL. Ollama must listen on an address reachable from Docker.
On Linux add `--add-host=host.docker.internal:host-gateway` to the run command.

```bash
# Preview: real LLM/feed calls and a read of the live corpus; no submission.
docker run --rm --env-file card-forge/.env card-forge:local --dry-run

# Submit generated cards to the live review queue.
docker run --rm --env-file card-forge/.env card-forge:local

# Only test the LLM: canned feeds, empty corpus, no game API calls.
docker run --rm --env-file card-forge/.env --entrypoint python \
  card-forge:local /app/scripts/live_smoke.py
```

The image defaults `CONTENT_API_URL` to `https://unholy.cards` (without `/admin`).
It calls `/api/content/cards` using the service token. Approve or deny results
at `https://unholy.cards/admin/content` using your admin login/token.
The agent does not need the admin credential. Environment files are runtime
inputs and are excluded from the image.

### Pull on another machine

The Card Forge workflow builds both Linux AMD64 and ARM64 images and publishes
them to GitHub Container Registry. Feature-branch builds use the `card-forge`
tag; builds from `main` use `latest`. Every build also gets its full commit SHA
as an immutable tag.

```bash
docker pull ghcr.io/jrrall/ace-cast/card-forge:card-forge
docker run --rm --env-file card-forge.env \
  ghcr.io/jrrall/ace-cast/card-forge:card-forge --dry-run
```

Create `card-forge.env` on that machine with:

```dotenv
CONTENT_API_URL=https://unholy.cards
CONTENT_API_TOKEN=your-service-token
LLM_BASE_URL=http://host.docker.internal:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=huihui_ai/qwen3-abliterated:8b
LLM_REASONING_EFFORT=none
```

Replace the LLM URL/model for your server. Remove `--dry-run` to submit a batch.
If the registry package is private, run `docker login ghcr.io` first using a
GitHub credential with permission to read it. Publishing requires pushing this
workflow to GitHub and a successful workflow run.
