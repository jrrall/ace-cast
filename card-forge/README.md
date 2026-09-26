# Card Forge

A standalone, multi-persona LLM agent chain that fetches trends, writes
MadLad-style cards, self-critiques / moderates / dedupes them, and POSTs the
survivors as **`pending`** to the [ace-cast](../README.md) content API. A human
reviews a configurable batch per run from the game's `/admin/content` review list; only approved
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
mocked LLM. Selected writers independently scout the same source pool, then write
from their own chosen themes without seeing each other's drafts. Editor and
moderator calls use chunks of up to 12 cards by default; curator scoring uses
chunks of 8. Empty stages skip calls. Calls run sequentially to avoid overloading
a local model. Logs record stage counts and model call timing.

| # | Persona | In → Out | Job |
|---|---------|----------|-----|
| 1 | **Trendscout** | feeds → `[Theme]` | Fetch from a curated source allowlist; distil untrusted feed titles into themes. |
| 2a | **Deadpan Writer** | `Theme` → `[CardCandidate]` | Calm understatement; absurd situations treated as routine. |
| 2b | **Unhinged Writer** | `Theme` → `[CardCandidate]` | Vivid, excessive escalation grounded in the same premise. |
| 2c | **PR Spin Doctor** | `Theme` → `[CardCandidate]` | Rebrands obvious failures as premium benefits. |
| 2d | **Petty Villain** | `Theme` → `[CardCandidate]` | Turns small grievances into elaborate, absurd revenge. |
| 2e | **Banned From 4chan** | `Theme` → `[CardCandidate]` | Mid-2000s forum shock humor: blunt filthy images, blasphemy, ugly confessions, and appalling priorities. |
| 2f | **Hatemonger** | `Theme` → `[CardCandidate]` | Ranting uncle: petty grievances, scrambled conspiracies, absurd statistics, and defensive self-owns. |
| 2g | **Toxic Positivity** | `Theme` → `[CardCandidate]` | Self-congratulatory charity, privilege lectures, and demands for gratitude. |
| 2h | **Intrusive Thoughts** | `Theme` → `[CardCandidate]` | Dangerous curiosity, forbidden associations, and catastrophically inappropriate possibilities. |
| 2i | **Super Bitch** | `Theme` → `[CardCandidate]` | Vicious queen bee: weaponized compliments, fake concern, and surgical social humiliations. |
| 3 | **Editor** | `[CardCandidate]` → `[CardCandidate]` | Repair wording; drop broken/duplicate cards; preserve unusual jokes. |
| 4 | **Moderator** | `[CardCandidate]` → `[ModeratedCard]` | Assign maturity 0–3, cap at the configured generator ceiling, drop out-of-policy + deny-listed. |
| 5 | **Curator** | `[ModeratedCard]` → `SubmitBatch` | Fetch the existing corpus (incl. denied), drop near-dups, rank/select up to `BATCH_MAX` (default 50). |

`CARDS_PER_THEME` is the total budget shared by all nine writers (minimum 9 when all are selected).
Leftover cards are allocated in roster order: Deadpan, Unhinged, PR Spin Doctor,
Petty Villain, Banned From 4chan, Hatemonger, Toxic Positivity, Intrusive Thoughts, then Super Bitch. The editor preserves their different voices;
the curator chooses strong cards across the roster without forcing a quota.

Then `client.py` POSTs the batch; the server re-validates, dedupes on
`(pack_id, text)`, and stores everything as `pending`.

## Editorial direction

Humor, tone, subject preferences, and comic mechanisms come from each persona's
TOML voice and phase instructions. Shared prompts handle card format, counts,
source provenance, maturity ceilings, and review mechanics. Editor and Curator
preserve and assess the supplied cards without a separate house comedy voice.
Maturity is an upper bound, not a requirement to make every persona equally extreme.
Fictional research seeds and smoke inputs describe neutral settings and details;
the selected persona supplies their comic interpretation.

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

`BATCH_MAX` caps pending cards per run (default **50**, range 1–50). Set it to
20 for a smaller review queue; use multiple runs to accumulate roughly 100
candidates a day. Each run still submits one API request. No scheduler is added.
The cap is a ceiling, not a target: `THEMES_PER_RUN` and `CARDS_PER_THEME` control
how many drafts are generated (defaults: 4 × 9), and review may remove cards.
`EDITOR_BATCH_SIZE=12` bounds cards per editor request; lower it to 6 if editing
still times out. This does not change the final batch cap. Exact duplicate edits
are removed across chunks; the curator checks repeated premises across the full
pool. `MODERATOR_BATCH_SIZE=12` and `CURATOR_BATCH_SIZE=8` also bound review
responses. Moderation judges independent cards; curator calls retain full-pool
context and prior premise labels, scoring only the requested range. Scores,
quality cutoff, duplicate groups, and type budgets are applied globally. Editor chunk progress is logged. A failed chunk still aborts before submission.
Prompt/answer slots remain split evenly, with an odd slot going to answers;
unused slots of one kind are not filled with the other kind.

The editor fixes wording and removes broken cards and genuine duplicates,
preserving weird, risky, and uncertain jokes for human judgment. The curator
ranks distinct playable cards instead of imposing its own short taste-based list.
`QUALITY_MIN=70` keeps a weighted quality cutoff by default; adjust it to tune
selectivity. Scores order the pool and playability checks remain. A low comic-turn score alone no longer discards a card.
Moderation and human approval still apply. Legacy `BATCH_MIN` is accepted but
has no effect. Existing explicit environment values override these defaults.


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
  This is an upper bound on content, not a shared humor style or intensity target.
  Personas supply creative direction; the moderator independently rates each card.
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
samples three neutral fictional situations and three setting/detail pairs
from local banks; they do not prescribe a joke or complication. Set `INSPIRATION_PER_LANE=0` to disable those, or 1–8 to
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

Each semantic release publishes a Linux AMD64 + ARM64 image at
`ghcr.io/jrrall/ace-cast/card-forge:X.Y.Z`, built from the exact `vX.Y.Z`
tagged commit. The same manifest is also tagged with the full commit SHA;
revision/version labels identify the source. Use an explicit published version:

```bash
# Set this to a version whose Card Forge image publication has succeeded.
VERSION=1.22.1
docker pull "ghcr.io/jrrall/ace-cast/card-forge:$VERSION"
docker run --rm --env-file card-forge.env \
  "ghcr.io/jrrall/ace-cast/card-forge:$VERSION" --dry-run
```

`1.22.1` is an example historical release that requires the manual backfill below.
The GitHub release alone does not prove its container publication succeeded.
Card Forge is the `/card-forge` image; it is separate from the game server
(which the Linode compose deployment builds locally as `ace-cast:latest`).
Do not use the repository-root image path to run Card Forge. Moving Card Forge
`latest` and `card-forge` aliases are no longer published or updated; old aliases
may still exist but are stale.

The Release workflow calls the image workflow directly after semantic-release
reports a new release. A no-release run skips image publication. It does not
rely on another workflow being triggered by a `GITHUB_TOKEN` tag push.
PR and branch validation only build/test; they have no GHCR write permission.

To backfill an existing published release, run the current workflow from `main`
and supply the historical tag (do not run the old workflow at that tag):

```bash
gh workflow run card-forge-release.yml --ref main -f tag=v1.22.1
gh run list --workflow card-forge-release.yml
```

The workflow verifies the GitHub release, resolves its tag to a commit, tests
that checkout, and builds both architectures from it. It never relabels an
unverified moving image. Run-specific `build-<run>-<arch>` staging tags
support assembly. The final version and SHA tags are checked before either is
written: identical manifests are left alone; a different manifest fails the
run. Registry/authentication errors also fail closed. Publication is serialized
per release across automatic and manual runs. These guards cover this workflow;
registry administrators must also avoid changing release tags externally.

If a rerun rebuilds different bytes (for example after a base-image update), it
will refuse to replace an existing release image even when its commit matches.
Keep the existing image and publish a new release for changed artifacts. Inspect
the workflow failure before retrying; never delete a version tag to bypass the
guard. Use a manifest digest when an independent content-addressed pin is needed.

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

Writers and the curator share a five-dimension quality rubric. The curator
returns integer scores from 0 to 5 and a short reason for each selected card.
Code calculates `20 * (0.30*playability + 0.25*comic_turn + 0.15*specificity +
0.10*economy + 0.20*originality)`. `QUALITY_MIN` defaults to 70/100;
`QUALITY_WEIGHTS` accepts a JSON object with all five nonnegative weights summing
to one. Playability must reach 3/5 regardless of the total; comic turn contributes
to the weighted score without a separate minimum.
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
| Banned From 4chan | 4 | 4 | 4 | 3 | 4 | 4 | 5 |

These profiles guide writing, not quotas or rewards for being explicit. The
curator ranks eligible cards by computed quality and keeps at most one per
model-assigned premise group. `curator.score` JSON logs include the card text,
quality dimensions, reason, score, and whether it was kept. Valid optional
style diagnostics are logged if supplied, but the Curator no longer requests
them. Reasons are requested in at most 12 words to reduce response size, but are
optional diagnostics. Five-element quality arrays are accepted in the prompt
order: playability, comic turn, specificity, economy, originality. Every score
still requires an integer 0–5; wrong lengths or invalid values fail validation.
Invalid curator schemas trigger a targeted re-evaluation of that chunk, bounded
by `LLM_JSON_RETRIES` (default 1). No dimension scores are invented from scalar
totals. Corrected responses are checkpointed separately, so an invalid cached
response no longer permanently blocks resume. Exhausted retries still stop
before submission.
These judgments are model estimates, not validated human preference scores.
The rubric uses mental combination checks; simulated gameplay and calibration
against human outcomes remain follow-up work. Scores are logs, not new database
fields or admin UI controls.

### Card type balance

The writing team divides each theme into equal prompt and answer budgets,
then assigns those slots across the selected writers. Writer and
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
Running an explicit registry version such as
`ghcr.io/jrrall/ace-cast/card-forge:1.22.1` uses that separately pulled release
image instead.

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
prompt/answer formats and author tracking as the other writers. With all nine writers,
`CARDS_PER_THEME` must be at least 9 for new runs; use 18 to give each writer one prompt and
one answer per theme. No franchise roleplay is included.

### Archived conspiracy research

The default feed list also includes
`https://archive.org/wayback/available?url=infowars.com`. This is a research
adapter, not a live news feed: it uses today’s month/day in a random year from
2000–2009 and asks Internet Archive for an Infowars homepage snapshot. Only a
capture on that exact date is accepted; nearest captures on other days are
skipped. February 29 selects only leap years. From a matching homepage it
samples up to two on-site article links. BeautifulSoup extracts bounded paragraph
excerpts. Every item carries its snapshot URL/date and a label identifying it as
unverified conspiracy claims. All writers can use the resulting themes.

Trendscout extracts paranoid certainty, false causality, and invented connections
as mechanisms for fictional comedy rather than treating the claims as facts.
Linked articles may resolve to nearby captures within the same era.
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

### Paired comedy loop (experimental)

Set `COMEDY_LOOP=true` to add one bounded exchange before the normal editor,
moderator, and curator. Writers draft independently first. Each writer then draws
a random challenger from the other personas with a theme in that round. Draws are
independent, so a persona may challenge multiple writers; nobody challenges themself.
A solo round keeps its originals. Checkpointed runs save each round’s draw before
critiques begin and reuse it on resume. Each challenger reviews the originals, and the original writer gets one
revision, which can retain the original. No model declares a winner. Invalid or
kind-changing revisions retain the original; malformed response envelopes fail
the run before submission. The judging pool keeps originals and distinct revisions; final submission budgets stay unchanged.

With all nine writers, this adds up to eighteen LLM calls per round (nine challenges
and nine revisions) to the nine drafting calls. Calls remain sequential for local Ollama. It is off
by default while human comparison establishes whether it improves the jokes.
Original writer attribution reaches the API; challenger and revision history
are in the local trace, not new admin fields.

From `card-forge/`, compare original and revised cards on a fixed theme:

```bash
docker build -t card-forge:dev .
docker run --rm --env-file .env -e MATURITY_MAX=3 -e CARDS_PER_THEME=12 \
  --entrypoint python card-forge:dev /app/scripts/live_smoke.py \
  --writers-only --comedy-loop \
  --theme 'A family reunion introduces a rule nobody wants to explain.' \
  | tee comedy-comparison.jsonl
```

No research, editor, moderator, curator, or game API is called in that test.
Draft/challenge/revision records print immediately, with original text, proposed
changes, author, challenger, source, and a run ID. Use `--live-research` instead
of `--theme` to use configured research sources. `--writers-only` without the
loop remains the existing baseline (set `COMEDY_LOOP=false` if enabled in .env).

For normal runs, exchanges are structured stderr logs. To persist them separately,
set `COMEDY_TRACE_PATH=/output/comedy.jsonl` and mount a writable directory with
`-v "$PWD/runs:/output"` (create `runs` first). The JSONL file is appended after
every completed call, preserving earlier drafts if a later call fails. It stores
card/research text and lineage, not credentials. This loop revises card drafts;
it does not yet introduce a separate free-form premise generation stage.


### Multiple routes into judgment and length review

Independent writer drafts, paired revisions (when `COMEDY_LOOP=true`), and short
b3ta source finds all compete in the final pool. The loop retains originals as
well as distinct revisions instead of replacing them automatically. The final
batch size and prompt/answer budgets remain unchanged.

`SOURCE_FINDS_MAX=6` enables up to six finds per run; set it to 0 to disable.
The scout selects indexes of actual short source lines, never model-invented
quotes. Finds are at most eight words/100 characters, with at most two per post.
They bypass the rewriting editor, then undergo length checks, moderation,
deduplication, and final judging. Puns and name mashups can stand on their own.
The source URL and `source_find` route are saved in the API/database and shown
in admin review/library; no writer persona is falsely credited. Writers-only
live tests print source finds alongside writer output, even when Trendscout
selects a theme from another source.

Before moderation, review flags prompts exceeding 24 words or 160 characters
and answers exceeding 12 words or 90 characters. One batched shortening call
preserves the comic payoff, kind, voice, and provenance. Failed or still-long
rewrites are dropped. Verbatim finds that exceed the final limit are dropped
rather than silently rewritten. `review.shorten` logs originals and revisions.
The writers-only test bypasses this review pass and shows raw output.

Deploy the game migration before using the updated Forge if source links and
route labels need to persist; older APIs ignore these new fields. Historical
cards retain unknown provenance. Challenger details remain in the loop trace.

### Resumable runs and JSON working files

Use `--run-dir` on a **host-mounted directory** to keep work after Docker exits
or `--rm` deletes the container. From the `card-forge/` directory:

```bash
docker build -t card-forge:local .
mkdir -p runs
caffeinate -i docker run --rm --env-file .env \
  -v "$PWD/runs:/output" \
  -e LLM_MODEL=huihui_ai/gemma-4-abliterated:12b \
  -e LLM_TIMEOUT=300 -e QUALITY_MIN=70 -e CARDS_PER_THEME=12 \
  card-forge:local --dry-run --run-dir /output/gemma-01
```

On Linux, omit `caffeinate`; ensure the mounted directory is writable by the
container's UID 10001 (or run with `--user "$(id -u):$(id -g)"`).
The JSON files appear in `runs/gemma-01/`:

- `research.json`: saved themes and source material, reused on resume.
- `calls/*.json`: each completed model request and response, saved immediately.
- `drafts.json`, `edited.json`, `moderated.json`: readable stage outputs.
- `final.json`: final API payload, also produced during dry runs.
- `submission.json`: submission intent and, on success, the API receipt.

If the run fails, repeat the **same command** with `--resume` added. Completed
calls are replayed locally and validated again; the unfinished request runs
again. A stage file is written only when that stage finishes, but completed
editor chunks and individual writer calls are already preserved in `calls/`.
Even if the curator times out, generation, editing, and moderation need not run
on the model again. Corpus dedupe still reads the API afresh before curation.
Timeouts, retry counts, `MODERATOR_BATCH_SIZE`, and `CURATOR_BATCH_SIZE` may
change on resume, including for checkpoints created before those two batch
settings existed. Resizing batches invalidates affected call-cache entries.
Model, generation, and other review
settings must match the saved manifest; use a new directory for a new experiment.
Changed prompts invalidate the affected cached calls. If research itself never
finished, research is retried and may choose new source material.

These files are application-managed JSON checkpoints, not an autonomous model
filesystem session. Stage files are inspection snapshots: editing them does not
change the pipeline's inputs. Do not edit cache files while a run is active.
Files are replaced atomically; a lock prevents two runs using the same directory.
Credentials are excluded from the manifest; requests and card/source text are
saved locally. Do not commit run directories.

Remove `--dry-run` when resuming to submit the reviewed result. A recorded
successful submission is returned without a second POST. If a prior submission
has an uncertain outcome, resume stops and asks you to reconcile the API queue;
it never assumes that a timeout means the POST failed. There is no automatic
submission retry. Old runs without checkpoints cannot be reconstructed from
stage-count logs alone.


### Toxic Positivity joins the normal writer roster

Toxic Positivity (`writer.toxic_positivity`) writes independent setups and answers
alongside the other writers. Her comic engine is self-congratulatory charity,
lectures about privilege, and the gap between her moral self-image and her
entitled decisions. Normal deck mixing supplies the cross-persona combinations;
there is no separate swap round or `OPPOSITES_ROUND` flag.

Use `CARDS_PER_THEME=18` to give each of the nine writers one prompt and one
answer per theme. The total is shared across writers; it is not a per-writer
count. Fresh runs selecting all eight need at least 8. Existing checkpoints preserve their saved
roster; checkpoints created before roster tracking retain the original six.
Start a new run directory to include newly added writers.

The optional existing critique/revision loop still works. Toxic Positivity's
drafts receive a challenge from Banned From 4chan; the original six
challenge assignments are unchanged. All output goes through the same editor,
moderator, curator, quality cutoff, and API batch limit.

### Editable TOML personas

Writer definitions live in `forge/persona_profiles/*.toml`. Add a file to add a
writer; no Python class or registration is needed. Each file has a stable `id`,
a display `name`, `enabled` (default true), optional integer `order` (default 100),
and a multiline `voice`. Existing IDs retain their `writer.<id>` attribution.

```toml
id = "petty_villain"
name = "Petty Villain"
enabled = true
voice = """
A tiny slight deserves elaborate, unreasonable revenge.
Your spite is completely justified in your own mind.
"""

[phases]
scout = "Find a tiny personal slight that could justify unreasonable revenge."
write = "Invent a fresh grievance and an unreasonable overreaction."
answer = "Respond to the supplied setup with disproportionate petty revenge."
critique = "Find the predictable retaliation; suggest one sharper direction."
revise = "Keep the grievance. Make the retaliation more specific."
```

Phase instructions are optional. `_defaults.toml` supplies shared `scout`, `write`,
`answer`, `critique`, and `revise` directions; persona overrides replace that
phase's default. Format rules, voice, and the current phase form the system
prompt. Themes, drafts, and feedback stay in the user input. Ordinary runs use
`write`; `COMEDY_LOOP=true` also uses `critique` and `revise`. The `answer` phase
is available through `Writer.answer(setup)`; it does not add an extra round to
normal runs. Review personas remain independent.

Research supplies each card's concrete detail or situation; the persona supplies
its interpretation and delivery. Bundled scout instructions ask for a specific
source detail and its connection to the persona in the returned `angle`, which
reaches the writer alongside the source excerpt. The shared writer prompt requires
grounding while treating source text as untrusted data, never instructions.
Start a new run to use updated scout profiles; resumed runs retain saved profiles
and any completed scouting or writing results.

`PERSONAS_DIR` selects a replacement folder. Its optional `_defaults.toml`
overrides bundled phase defaults. Invalid files, duplicate IDs, unknown phases,
and empty enabled rosters fail with an error. `WRITERS_PER_RUN=0` uses all enabled
writers; set it to `6` to randomly select six without replacement each new run.
`CARDS_PER_THEME` is the total budget across the selected roster; use 12 for six
writers to each get one prompt and one answer. Winners/fitness and automated
persona rewriting are not implemented; selection is currently random.

For editable files in Docker, add these flags to your usual run command:

```bash
-v "$PWD/forge/persona_profiles:/personas:ro" \
-e PERSONAS_DIR=/personas \
-e WRITERS_PER_RUN=6 \
-e CARDS_PER_THEME=12
```

New checkpoints store the selected roster, full resolved persona definitions,
and content hashes in `manifest.json`. Resume uses those snapshots even if TOML
files change or disappear. Start a new run directory to use edited personas.
Older checkpoints without snapshots freeze the current matching definitions on
first resume and log a warning; they cannot recover definitions never saved.
Shared Python format/protocol changes can still invalidate cached calls, so use
the same image when resuming. No model automatically rewrites persona files.

### Persona-specific scouting

New runs default to `PERSONA_SCOUT=true`. Research collection fetches once, mixes
in fictional seeds, deduplicates, and samples up to 60 items across sources.
Each selected persona receives up to `THEMES_PER_RUN` small batches, with at most
`SCOUT_BATCH_SIZE=6` stories each. Source-interleaved assignments share one anchor
per batch across personas and deterministically rotate the remaining stories by
roster position. Stories never repeat within a persona. Short pools produce
smaller/fewer batches; empty pools produce no scout calls. Nothing pads or expands
the pool after a null result.

Each call uses the persona's voice and `[phases].scout` instructions, returning
one `theme` with `story_id`, `title`, and `angle`, or `theme: null`. User messages
contain only bounded story JSON and request metadata. Invalid selections trigger
a bounded retry of that batch. Code attaches original provenance. Each writer
receives only its own chosen themes; the optional comedy loop preserves each
author's research context when another persona challenges a card.

Every bundled persona explicitly defines `scout`, `write`, `answer`, `critique`,
and `revise`. Custom files can still omit phases to inherit `_defaults.toml`.
`THEMES_PER_RUN` limits batches **per selected persona**; the run summary counts
chosen themes. Card budgets are still divided across the roster. Six writers,
two batches each, and `CARDS_PER_THEME=12` mean up to 12 initial scout calls and
24 initial drafts, before optional critique/revision and review. Schema/transport
retries can add calls. `TABLOID_PERCENT` remains a soft scouting preference.

With a run directory, `research.json` freezes the full sampled pool and
`scout_plan.json` saves every persona's batch membership before scouting begins.
`scout_batches/writer.<id>/<index>.json` immediately saves each completed batch,
including null results, story IDs, selection, resolved theme, and persona version.
Resume reuses that plan, pool, roster, definitions, and completed selections;
changing `SCOUT_BATCH_SIZE` requires a new run directory.

New checkpoints use `batches-v1`. Older `stories-v1` checkpoints keep their full-pool
structured requests, and legacy checkpoints keep their original scouting route.
`PERSONA_SCOUT=false` explicitly selects the old shared-scout flow for a new run.
The writer-only smoke script uses the same batch scheduler unless an explicit
`--theme` supplies the theme directly. No extra model ranking stage is involved.
Runtime and card-quality comparison against full-pool scouting remains #69.

`banned_from_4chan.toml` replaces `banned_from_the_thread.toml`; its display name is
Banned From 4chan. Saved persona snapshots keep their original identities on resume.

### Structured research stories (#67)

New persona-scout runs save individual stories in `research.json`: content-based
`id`, `source`, `title`, `url`, and full `excerpt`. Exact records are deduplicated;
different articles/posts sharing a title stay separate. IDs are deterministic
for identical full records (a changed excerpt produces a new ID).

Scout user messages contain JSON `stories`, `max_themes`, and
`tabloid_preference_percent`. Titles are capped at 300 characters, source labels
at 160, and excerpts at `SCOUT_EXCERPT_CHARS` (default 800, range 100–4000).
URLs and full text stay in the checkpoint. The older `stories-v1` protocol returns `themes` with
`story_id`, `title`, and `angle`; only IDs in the submitted stories are accepted.
Original source metadata is attached in code, never taken from the model.

Legacy checkpoints retain numbered-source scouting for resume compatibility.
The `stories-v1` protocol sends the sampled pool in each call; new `batches-v1`
runs use the small batches and per-batch recovery described above.

Scout requests use exact short IDs (`story-` plus 12 hash digits); checkpoints
retain the full hashes. Short-ID collisions fail before sending a request.
Old full IDs remain accepted, but misspelled IDs are never fuzzy-matched.

### Measuring scout batches (#69)

Both structured scout routes emit `scout.attempt` JSON events with persona,
protocol, batch index, story count, input character count (system plus user),
user-only character count, one-based schema attempt, duration, validation failure,
error type, and selected-theme count. `source` distinguishes fresh `generation`
from raw-response `cache` replay. `scout.reused` denotes a completed `checkpoint`
batch; its input count and model duration are zero, including cached null results.
Do not interpret replay speed as model-generation speed.

`model_attempts` counts application-level model attempts, including bounded JSON
format retries; `format_retries` is separate from schema retries. SDK transport
retries can add HTTP attempts in ordinary runs. The comparison tool disables
those retries, uses fresh clients without response caches, and does not change
the saved source run.

Run a bounded comparison from an existing checkpoint with saved research and
persona definitions:

```bash
cd card-forge
uv run python scripts/compare_scouts.py \
  --source-run runs/your-saved-run \
  --output runs/scout-comparison-01 \
  --personas 2 --max-calls 24 --max-seconds 900 --timeout 90
```

For a host process reading a Docker-created checkpoint, add
`--base-url http://localhost:11434/v1`. Credentials come from the current environment
or `.env`; model, research, persona definitions, roster order, and generation
settings come from the saved manifest. JSON retry count comes from current
settings and is frozen equally for both routes. The default two-persona sample
retains the original full-roster card budgets. Pass a larger `--personas` count
to cover more of the saved roster. Both routes use the same settings and research;
the route-specific prompts and batch assignments are the comparison treatment.

The tool alternates route order by persona, runs full-pool scouting and small-batch
scouting, then writes drafts only from that persona's selected themes. It records
failed units and continues within the call/time budget. The time budget is checked
before each call and used to shorten remaining request timeouts; in-flight calls
still follow the client's timeout behavior. Schema retries and writing count
against `--max-calls`; each logical call can additionally make the configured
bounded JSON-format retries. Output directories must be new; repeat into a new
directory instead of mixing fresh measurements with replay.

Local artifacts:

- `inputs.json`: frozen input/settings, persona snapshots, limits, and fingerprint;
  API keys and content tokens are excluded.
- `calls.jsonl`: requests, responses or failure types, timings, and model-attempt
  counts, flushed after every call.
- `scout-events.jsonl`: per-attempt telemetry with the comparison route.
- `outcomes.json`: selected story IDs, angles, and writer-attributed candidate cards,
  updated after each unit.
- `summary.json` and `report.md`: request sizes, scouting and writing durations, retries/failures,
  distinct selected stories/sources/angles, and draft counts by card kind.

No cards are submitted, moderated, curated, or published by this tool. The existing
admin approval loop remains the human card-quality review path; there is no extra
benchmark approval workflow. Distinct wording and more drafts do not establish
funnier cards or preserved persona quality. A single sample also cannot establish
reliability rates. Keep `SCOUT_BATCH_SIZE=6` as the current operational default
unless repeated measurements justify a change. JSON formatting bounds the input
representation; it does not itself prevent output overproduction. Existing output
caps and retained-selection validation still enforce the requested limits.

#### Initial local measurement (2026-09-26)

Using the 60-story pool and frozen definitions from `gemma-20260926-101326`,
compared Deadpan and Unhinged with `huihui_ai/gemma-4-abliterated:12b`, two themes
per persona, batch size six, temperature 0.8, and the original six-persona
allocation of two cards per selected theme. Both routes used a 90-second request
timeout, one allowed JSON/schema retry, and zero SDK transport retries. The
comparison was capped at 24 logical calls / 900 seconds; it used ten fresh calls.

| Measure | Full pool | Six-story batches |
| --- | ---: | ---: |
| Scout calls | 2 | 4 |
| Median request characters, system + user | 16,470 | 2,563 |
| Total scout request characters | 32,940 | 10,307 |
| Observed scouting seconds, including timeouts | 180.166 | 131.836 |
| Scout timeouts | 2 | 0 |
| Schema/JSON retries | 0 | 0 |
| Selected distinct stories | 0 | 4 |
| Selected source labels | 0 | 3 |
| Draft cards | 0 | 8 (4 prompts, 4 answers) |

The batch route selected two themes per persona and wrote eight distinct draft
texts in another 109.256 seconds, without writer failures. No cache/checkpoint
replay was included. All four batch selections passed validation on their first
attempts. Both full-pool calls timed out, so their timings are lower bounds on
successful completion time, and they supplied no baseline drafts for a quality
comparison. Zero retries on that route does not imply valid output: no output
arrived before timeout.

This sample supports retaining the six-story default under this timeout budget;
it does not establish general reliability, funnier output, or preserved persona
quality. That judgment stays with the existing admin approval loop. The local
artifacts are in `runs/scout-comparison-issue69/` (ignored by Git); candidate cards
were not submitted or published.

### Intrusive Thoughts and Banned's spoken voice

`intrusive_thoughts.toml` adds `writer.intrusive_thoughts`, enabled by default.
This voice finds the immediate, appalling possibility in something recognizable:
a dangerous object, a solemn occasion, or an outrageously inappropriate crossover.
The thought stays brief, hypothetical, and unacted. Its comic mechanism is the
forbidden association arriving before judgment catches up. The optional comedy
loop draws its challenger randomly from the other personas in that round.

Banned From 4chan's compact voice asks for uncensored fuck/fucking as punctuation
in prompts and answers at maturity 3. Profanity is part of the character's speech; each
card still needs a concrete terrible decision or self-own underneath it. Each phase adds one short task instruction to that shared voice.

New runs load these definitions. Resuming a checkpoint preserves its old roster
and frozen voices, even if the TOMLs change. `WRITERS_PER_RUN=6` samples six of the
nine enabled personas, so either writer can be absent from a particular run.
Use `WRITERS_PER_RUN=0` and `CARDS_PER_THEME=18` to run all nine with one prompt
and one answer slot per writer per theme. Deploy the updated image or mount the
updated persona directory before starting that new run.


Shared prompt changes require the updated code/image as well as persona files.
Start a fresh run to use neutral research seeds and the new review instructions;
existing checkpoints retain their saved source material and persona snapshots.


### Bounded calls and curator recovery

Fresh model requests have phase-specific output-token limits: 256 tokens of JSON
headroom plus 160 per written card, 256 per scout theme or curator evaluation,
192 per edited/shortened card, 128 per moderation verdict, 320 per critique,
160 per revision, 64 per repaired group label, or 16 per source selection.
Every request is capped at 16,384 output tokens; unclassified calls use 4,096.
Truncated output remains invalid; each configured JSON-format retry doubles its
output allowance up to the 16,384-token ceiling. Other format failures retain their allowance.
For Qwen thinking models on Ollama, set `LLM_REASONING_EFFORT=none` for these
short structured tasks. An empty value leaves the server default in effect, which
can spend the output budget on reasoning. Logs report reasoning character counts
when the server supplies a separate reasoning field.
These are initial budgets, not measured latency guarantees.

`LLM_TIMEOUT_RETRIES=1` retries a timed-out request once after two seconds, across
all JSON-format attempts for that call. Set it to `0` to fail immediately.
It does not stack with nonzero `LLM_MAX_RETRIES` (SDK retries); comparisons disable
transport retries to preserve their time budget. A backend stall can still time out.

Call logs include phase, persona and batch where applicable, input characters,
output-token limit, and returned prompt/completion token usage. No extra diagnostic
model requests run. Existing successful response-cache entries remain reusable.

Validated curator batches are saved under `curator_batches/`. Resume reuses them
when the exact card pool, batch boundaries, prior group context, model, maturity,
and rubric match, even if prompt wording changed. Changed cards or batch sizes
cause affected scoring to run again. API corpus deduplication and final ranking
still run on resume. Older runs gain these batch checkpoints as scoring completes;
previous successful calls can still be reused through the existing response cache.


### Packs named after runs

With `--run-dir`, the final folder name becomes the submitted pack slug and display
name: `/output/qwen35-20260926-134926` creates `qwen35-20260926-134926`.
Use lowercase letters, digits, hyphens, or underscores (up to 128 characters).
Future themed runs can use names such as `sportsball-qwen35-20260926-134926`;
this naming change does not implement a sports research chain.

`PACK_SLUG` identifies the existing base generated pack (`madlad-generated`), which
supplies the game identity. Without checkpoints it remains the direct destination.
The API creates run packs only from a valid generated base, leaves their cards
pending, and includes approved run-pack cards in the default deck. Explicit pack
selection still selects only the requested packs.

The checkpoint freezes the pack name, even if its directory is later moved.
Unsubmitted legacy checkpoints adopt their folder name on resume; checkpoints
with a submission record preserve their original destination and submission guard.
Deploy the server and its run-pack migration before using this Forge change to
submit: older servers reject unknown pack names. Dry runs do not create packs.

### Super Bitch

`super_bitch.toml` adds `writer.super_bitch`, enabled by default: an adult queen
bee with Mean Girls energy turned up to eleven. Her weapons are backhanded
compliments, fake concern, social exclusion, and viciously specific status
judgments. Unlike Petty Villain, she needs no grievance: she considers enforcing
the hierarchy a public service. Each phase favors concrete social humiliations
over generic insults. In the optional comedy loop, her challenger is drawn
randomly from the other personas in that round.

New runs can select her; existing checkpoints retain their saved roster and
voices. Use `WRITERS_PER_RUN=0` and `CARDS_PER_THEME=18` to give all nine writers
one prompt and one answer slot per theme.

### Incomplete moderation responses

The moderator retries missing, duplicate, or malformed verdicts using
`LLM_JSON_RETRIES`, preserving valid verdicts and the original card indexes.
If any unresolved cards remain, the run fails before submission instead of
silently discarding them. Deny-listed cards, explicit disallow decisions, and
ratings above the configured maturity ceiling still exclude cards normally.
Checkpointed model responses remain reusable after an interrupted retry.
