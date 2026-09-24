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

## The persona chain

Each stage has typed card/theme models and is independently testable with a
mocked LLM. Six writers each call the model once per theme, receiving identical
research without seeing each other's drafts. The other stages make at most one
call each and may skip empty inputs. A four-theme run normally makes twenty-four
LLM calls. Writer calls run sequentially to avoid overloading a local model. Logs record stage counts and LLM call start/completion times.

| # | Persona | In → Out | Job |
|---|---------|----------|-----|
| 1 | **Trendscout** | feeds → `[Theme]` | Fetch from a curated source allowlist; distil untrusted feed titles into themes. |
| 2a | **Deadpan Writer** | `Theme` → `[CardCandidate]` | Calm understatement; absurd situations treated as routine. |
| 2b | **Unhinged Writer** | `Theme` → `[CardCandidate]` | Vivid, excessive escalation grounded in the same premise. |
| 2c | **PR Spin Doctor** | `Theme` → `[CardCandidate]` | Rebrands obvious failures as premium benefits. |
| 2d | **Petty Villain** | `Theme` → `[CardCandidate]` | Turns small grievances into elaborate, absurd revenge. |
| 2e | **Banned From the Thread** | `Theme` → `[CardCandidate]` | Mid-2000s forum shock humor: blunt filthy images, blasphemy, ugly confessions, and appalling priorities. |
| 2f | **Hatemonger** | `Theme` → `[CardCandidate]` | Ranting uncle: petty grievances, scrambled conspiracies, absurd statistics, and defensive self-owns. |
| 3 | **Editor** | `[CardCandidate]` → `[CardCandidate]` | Cull broken/unfunny/dupe cards; tighten wording. |
| 4 | **Moderator** | `[CardCandidate]` → `[ModeratedCard]` | Assign maturity 0–3, cap at the configured generator ceiling, drop out-of-policy + deny-listed. |
| 5 | **Curator** | `[ModeratedCard]` → `SubmitBatch` | Fetch the existing corpus (incl. denied), drop near-dups, rank/select 10–20. |

`CARDS_PER_THEME` is the total budget shared by all six writers (minimum 6).
Leftover cards are allocated in roster order: Deadpan, Unhinged, PR Spin Doctor,
Petty Villain, Banned From the Thread, then Hatemonger. The editor preserves their different voices;
the curator chooses strong cards across the roster without forcing a quota.

Then `client.py` POSTs the batch; the server re-validates, dedupes on
`(pack_id, text)`, and stores everything as `pending`.

## Editorial direction

The chain targets adult Gen Z humor: deadpan absurdity, surreal escalation,
ironic overconfidence, and online behavior colliding with real consequences.
News supplies the contradiction or comic premise; cards should work without
recognizing the headline. Avoid millennial-burnout filler and forced slang.
Writer, Editor, and Curator share this direction with Trendscout. Prompts must
have exactly one blank that accepts an unrelated answer card.
The local smoke test uses explicitly fictional sample headlines in this vein.

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
- `PACK_SLUG` / `MATURITY_MAX` — target pack and generator maturity ceiling (default 3).
  At 3, writing and review explicitly target extreme adult comedy while the
  moderator independently rates each card. Lower ceilings remain configurable.
  The content API accepts ratings 0–3 regardless of pack metadata; it does not
  impose a pack maturity ceiling. Cards still require approval, and gameplay
  continues to respect the room's maturity filter. Redeploy the game before
  submitting rating-3 cards to a server that enforced the old pack ceiling.

## Feed sources, ToS, and safety

Review-feedback retrieval, generation provenance, and taste evaluation are
[deferred follow-up stories](../docs/card-forge-feedback-backlog.md), outside
the current feature's scope.

Trendscout fetches **only** its curated feed URLs. Defaults are Know Your Meme,
BBC News, The Guardian World, NPR News, Ars Technica, 404 Media, and The Guardian
Life and Style, plus Library of Congress Today in History. This covers memes, world and US news, technology, internet
culture, relationships, and everyday life. Arbitrary scraped URLs are never used.

Headlines are interleaved by source before the 60-headline research limit, with
identical headlines removed. A long feed cannot crowd out all the later feeds.
Unavailable feeds are logged and skipped; the run fails if none return items.
History entries include a short article excerpt and source link. Each run also
samples three fictional everyday situations and three off-the-cuff premises
from local banks. Set `INSPIRATION_PER_LANE=0` to disable those, or 1–8 to
adjust each bank. These are labeled fictional, not reported events. This is
one research pass with no recursive browsing. Themes carry only their selected
source context; unrelated headlines are not appended to every writer request.

`FEED_ALLOWLIST` replaces these defaults, so remove an old two-source override
from your local environment to use the expanded list.

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

### Compare the writers locally

From `card-forge/`, build and test your working tree without pushing anything:

```bash
docker build -t card-forge:dev .
docker run --rm --env-file .env.local \
  --add-host=host.docker.internal:host-gateway \
  -e LLM_BASE_URL=http://host.docker.internal:11434/v1 \
  -e LLM_TIMEOUT=300 -e LLM_REASONING_EFFORT=none \
  --entrypoint python card-forge:dev /app/scripts/live_smoke.py --writers-only
```

This uses fictional sample news and your configured LLM. It prints one JSON
line per writer/theme, labeled `writer.deadpan`, `writer.unhinged`, `writer.pr_spin_doctor`,
`writer.petty_villain`, or `writer.banned_from_the_thread`, immediately
after that call finishes. These are raw drafts, before editing and moderation.
It never contacts the game API or submits cards. Redirect stdout to a file to
keep the drafts even if a later writer fails. Omit `--writers-only` to exercise
the full chain. Use your LLM's LAN URL instead if it runs on another machine.


### Fictional tabloid share

`TABLOID_PERCENT=25` reserves approximately one quarter of writing themes for
Weekly World News inspiration. Four-theme runs reserve one theme; one-theme
runs choose the tabloid lane with 25% probability. Use `TABLOID_PERCENT=100`
for a focused test or `0` to disable it. This controls writing themes, not the
percentage of final approved cards: editing and curation can reject any draft.

The allowlisted `https://weeklyworldnews.com/archive/` page is fetched once.
Using the process's current date, Card Forge finds matching month/day entries,
chooses uniformly among available prior years, then picks one story from that
year. If no exact anniversary exists, it uses the same month and labels the
fallback. No matching month or an unavailable archive means no reserved tabloid
themes for that run. It does not crawl linked articles or Google Books scans.

Source date and URL accompany the theme; the material is explicitly fictional
inspiration. Multiple reserved themes use different situation angles on the
selected story. A custom `FEED_ALLOWLIST` must include the archive URL to enable
this source. The run's date follows the container timezone (usually UTC).


### Quality rubric and writer styles

Writers and the editor share a five-dimension quality rubric. The curator
returns integer scores from 0 to 5 and a short reason for each selected card.
Code calculates `20 * (0.30*playability + 0.25*comic_turn + 0.15*specificity +
0.10*economy + 0.20*originality)`. `QUALITY_MIN` defaults to 70/100;
`QUALITY_WEIGHTS` accepts a JSON object with all five nonnegative weights summing
to one. Playability and comic turn must each reach 3/5 regardless of the total.
Missing or invalid selection/quality evaluations fail the run rather than bypassing
the gate. Style diagnostics do not participate in selection and are optional;
malformed style scores are omitted with a warning rather than losing a batch.

Style scores are separate from quality. Writer targets in `forge/rubric.py`
use the following starting profiles (0 absent to 5 dominant):

| Writer | Unhinged | Lewd | Dark | Gross | Blasphemous | Deadpan | Implication |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Deadpan | 1 | 1 | 3 | 1 | 2 | 5 | 4 |
| Unhinged | 5 | 3 | 4 | 3 | 3 | 2 | 4 |
| PR Spin Doctor | 2 | 1 | 3 | 1 | 4 | 4 | 3 |
| Petty Villain | 3 | 2 | 2 | 1 | 2 | 3 | 5 |
| Banned From the Thread | 4 | 4 | 4 | 3 | 4 | 4 | 5 |

These profiles guide writing, not quotas or rewards for being explicit. The
curator ranks eligible cards by computed quality and keeps at most one per
model-assigned premise group. `curator.score` JSON logs include the card text,
quality dimensions, reason, score, and whether it was kept. Valid optional
style diagnostics are logged if supplied, but the Curator no longer requests
them. Reasons are requested in at most 12 words to reduce response size.
These judgments are model estimates, not validated human preference scores.
The rubric uses mental combination checks; simulated gameplay and calibration
against human outcomes remain follow-up work. Scores are logs, not new database
fields or admin UI controls.

### Card type balance

The writing team divides each theme into equal prompt and answer budgets,
then assigns those slots across the six writers. Writer and
Curator enforce separate type budgets using `CARDS_PER_THEME` and `BATCH_MAX`,
respectively; an odd slot goes to answers. They scan the full returned list so
prompt-first ordering cannot crowd out later answers. Curator ranks all worthy
cards, and only its selected cards can be published. Missing or rejected cards
leave slots empty instead of being replaced by the other type, so small batches
can still be uneven. This targets new generation, not the existing pack ratio.
Writer, Editor, Moderator, and Curator stage logs include `prompts` and `answers`
to show where either type is lost.

### Malformed model JSON

Each successful stage uses one completion per call. Invalid or truncated model
JSON gets one fresh, more concise retry at temperature 0 (`LLM_JSON_RETRIES=1`,
configurable 0–2). This is separate from SDK transport retries. Exhausting that
budget aborts generation before submission. Truncated responses are never
accepted as partial card lists. Logs include the completion finish reason and
JSON parse location without dumping model content. Format retries can add one
LLM timeout per attempt; they never retry the submission POST.

If you build `card-forge:dev`, run that same tag to use your local changes.
Running `ghcr.io/jrrall/ace-cast/card-forge:latest` uses the separately pulled
registry image instead.

### Writer attribution

Writer IDs (for example `writer.unhinged`) are assigned by code, carried through
editing using the original draft index, and submitted with every new card.
The editor cannot overwrite the author. A rewritten draft without a valid
source index is dropped rather than assigned to a guessed writer; uniquely
matching unchanged drafts can retain attribution without an index.

After deploying the game migration, the review queue and card library show
writers, the library can filter by writer, and the admin overview shows pending,
approved, denied, and approval percentage per writer. Use these review outcomes
to identify voices to tune; they are not measured laugh rates. Cards generated
before attribution was recorded remain Unknown. Deploy the game before using
the updated generator, otherwise older servers will ignore writer metadata.

### b3ta discussions as research

The default feed list includes `https://b3ta.com/questions/imagechallenge/`.
BeautifulSoup extracts post titles and bodies, removes bylines/signatures, and
keeps sampled replies with their original discussion. Per configured topic, each
run reads the latest page, one randomly chosen linked archive page, and at most
three reply threads. It returns up to eight discussions, with bounded excerpts.
Only same-topic reading links are followed; profiles, posting links, external
links, and redirects are excluded. Failed child pages leave the original posts
usable. Forum material is labeled unverified and passed as untrusted data.
Trendscout can preserve wordplay and crude riffs as mechanisms for original cards.

An existing `FEED_ALLOWLIST` overrides defaults: append a canonical b3ta topic URL
to that comma-separated list to include it. No cache or volume is required;
pages are fetched again each run.

From `card-forge/`, inspect raw drafts using only live b3ta research:

```bash
docker build -t card-forge:dev .
docker run --rm --env-file .env -e MATURITY_MAX=3 \
  -e FEED_ALLOWLIST=https://b3ta.com/questions/imagechallenge/ \
  -e INSPIRATION_PER_LANE=0 -e TABLOID_PERCENT=0 \
  --entrypoint python card-forge:dev /app/scripts/live_smoke.py \
  --writers-only --live-research | tee b3ta-drafts.jsonl
```

This prints the theme, source URL, research excerpt, and each writer's raw cards.
It never submits cards. Without `--live-research`, the smoke command still uses
its fictional sample headlines. Normal Forge runs automatically use configured
feeds, including b3ta, before the normal editing and review stages.

Hatemonger (`writer.hatemonger`) writes as a paranoid uncle whose certainty
exposes his own ridiculous reasoning. His invented stats concern absurd habits
and objects; conspiracies scramble cause and effect. Cards retain the same
prompt/answer formats and author tracking as the other writers. With six writers,
`CARDS_PER_THEME` must be at least 6; use 12 to give each writer one prompt and
one answer per theme. No franchise roleplay is included.

### Archived conspiracy research

The default feed list also includes
`https://archive.org/wayback/available?url=infowars.com`. This is a research
adapter, not a live news feed: it picks a random date in 2000–2009, asks Internet
Archive for the nearest available Infowars homepage snapshot in that era, and
samples up to two on-site article links. BeautifulSoup extracts bounded paragraph
excerpts. Every item carries its snapshot URL/date and a label identifying it as
unverified conspiracy claims. All writers can use the resulting themes.

Trendscout extracts paranoid certainty, false causality, and invented connections
as mechanisms for fictional comedy rather than treating the claims as facts.
Unavailable articles fall back to the archived headline, explicitly labeled
headline-only. An unavailable homepage logs a source failure and other feeds
continue. No transcripts, video downloads, or live Infowars requests are used.
Redirects remain limited to approved Infowars snapshots on web.archive.org.
A run makes one availability request, one homepage request, and at most two
article requests; each snapshot fetch allows at most two redirects. No cache is
currently used.

Existing `FEED_ALLOWLIST` values override defaults; append the URL above to add
this source to your configured mix. To inspect raw drafts using only this source,
use the b3ta live-research command above with:

```bash
-e 'FEED_ALLOWLIST=https://archive.org/wayback/available?url=infowars.com'
```

Keep `--writers-only --live-research`, `INSPIRATION_PER_LANE=0`, and
`TABLOID_PERCENT=0` for that focused test. Normal runs mix it with the other
configured research sources; inclusion in the input pool does not guarantee
Trendscout will select a theme from it on every run.
