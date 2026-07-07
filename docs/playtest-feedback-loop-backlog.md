# Playtest Feedback Loop — Backlog (groomed)

Groomed from: "playtesting soon → players flag cards → an AI agent watches flags
and generates more cards based on wins." The goal is a closed loop: **play →
capture signal (flags + wins) → generate/prune cards → play again.**

## Why E2 already set this up
The loop depends on one thing: **every card having a stable id that flows through
play.** E2.3 delivered exactly that — cards went from bare strings to `{id,text}`
objects carried through hands, submissions, and wins. So a winning card is now
knowable *by id*. That's the telemetry hook the whole loop hangs on.

## Locked decisions
- **Flag reasons: `not_funny` and `broken` only.** No "offensive" flag (content is
  intentionally mature — we don't want players nuking spicy cards) and no explicit
  "loved it" (positive signal comes from **win-rate**, not a love button).
- **The AI agent auto-publishes** generated cards — into a **dedicated
  `madlad-generated` pack**, isolated from `madlad-core`, so it's one switch to
  disable and easy to roll back.
- **Taste is scoped by a swappable key, not hard-wired.** The agent grows cards
  toward a **humor fingerprint** keyed by `scope_id`. That key is a *constant now*
  (`"global"`) and becomes a session id, then a group id, later — same generation
  code, same dashboard, no rewrite. This is what makes the epic **iterable over
  time**: each rung ships a working loop and none throws away the last (see F5).
- **No content guardrail for the playtest.** Generation runs unconstrained; you
  iterate on output quality directly from the dashboard signal.
- **Generation uses your own models** (self-hosted / your choice), not a hosted API.
  The agent is model-agnostic: it hands winners-as-context to your model and ingests
  the cards it returns.
- **Near-term:** groom the full epic first (this doc), then build.

## The three-stage loop
```
              ┌─────────── play (MadLad, DB-backed) ───────────┐
              ▼                                                 │
   capture:  F1 outcomes — (white × black × judge → won?)      │
             F2 flags (not_funny / broken)                     │
              ▼                                                 │
   store:    F3 per-card stats + dashboard  ◄── F4 perf model  │
             + F5 humor fingerprint[scope_id] = tag histogram  │
              ▼                                                 │
   act:      F5 AI agent → seed + fingerprint → gen → rank ────┘
             → publish (A/B vs core) + prune (F4/F6)
```

## Prerequisites / relationships
- **E1/E2 (done):** DB + cards with ids. Hard dependency — satisfied.
- **F0 deploy** is the real blocker to playtesting *at all* (app is live on Fly but
  on the old file deck; needs Postgres + the DB build).
- **Flag attribution:** flags need a flagger id to curb spam. Use a lightweight
  device/session token now (a slice of **S0**); full accounts (E4) later.
- **F1 overlaps S2** (session stats) — this is a focused card-centric slice of it.
- **F5 relates to** the offline SD sprite pipeline (E3.2) pattern; generation runs
  on your own model(s), model-agnostic behind a small interface.

Legend: `S`≈1–2 days · `M`≈3–5 days · `L`≈1–2 weeks.

---

## Epic F — Playtest Feedback Loop

### [F0] Deploy the DB-backed build on Postgres (Fly) — `M`  *(critical path to playtest)*
- [ ] Provision Fly Postgres and `fly postgres attach` (sets the `DATABASE_URL` secret).
- [ ] Confirm boot-time migrate + seed (E2.3 `start()` already does this) creates
      `madlad-core` in prod; `/healthz` reports DB ok.
- [ ] Play a real game in prod sourced from the DB (smoke test).
- [ ] Doc the deploy steps in `DEPLOY.md`.
- Depends on: **E2.3 merged** (deck from DB).

### [F1] Card outcome telemetry — `M`
**Value:** know which cards actually win — *and in what context, judged by whom.*
- [ ] Persist per-round outcomes as the **humor tuple**, not card-alone: on
      `pick-winner`, record each submission as `(white_card_id, black_card_id,
      judge_player, won?)` plus `scope_id` (the taste key — a constant `"global"`
      now; see the Locked decisions). **This tuple is the one thing that's expensive
      to backfill** — capture it from the first playtest even if nothing consumes the
      context/judge columns yet. It's what unlocks every F5 rung.
- [ ] Data model: append-only `card_events` (one row per submission, carries the full
      tuple) + a derived `card_stats` aggregate for fast dashboard reads. Events over
      bare counters here *because* the tuple needs the flexibility — counters alone
      can't express "won when the black card was about X, judged by player A".
- [ ] Written in the **server/GameRoom layer**, never the engine (engine stays pure).
- [ ] Black-card "engagement" too (rounds it produced) — optional stretch.

### [F2] Card flagging — `M`
**Value:** the explicit negative signal.
- [ ] `card_flags`: id, card_id, reason (`not_funny` | `broken`), flagger_id,
      created_at. Unique (card_id, flagger_id, reason) to stop spam.
- [ ] Phone UI: a small flag affordance on a card (in hand and/or on the revealed
      submissions), two reasons.
- [ ] Socket event / endpoint to record a flag (rate-limited).
- [ ] Flagger id from a device/session token (S0-lite).

### [F3] Feedback dashboard — `M`
**Value:** see the signal; drive manual + agent decisions.
- [ ] Per-card view: win-rate (with a min-plays threshold), play count, flag counts
      by reason; sortable, filter by pack.
- [ ] Highlights: top winners, dead weight (low win-rate, high plays), most-flagged.
- [ ] Internal/admin-gated (not public).

### [F4] Performance model + retirement thresholds — `S`
**Value:** turn raw stats into keep/cut decisions.
- [ ] Define `win_rate = wins / plays` (ignore cards below a min-plays floor).
- [ ] Retirement rule: flag_rate above X or win_rate below Y (with enough plays) →
      mark a card `retired` (excluded from decks) — conservative defaults, config-tunable.
- [ ] Retiring is reversible (soft flag, not delete).

### [F5] AI card-generation agent — off-hours, iterable toward "your table's humor" — `L`
**Value:** the deck **grooms itself while you sleep** and drifts toward the humor of
the people actually playing. The goal isn't *more* cards — it's cards this crew finds
funny — and the design is a **ladder** you can stop climbing at any rung with a
working system in hand.

**Shape (constant across every rung):** a nightly batch job (cron/script, like the
sprite pipeline — **NOT in the request path**) that reads yesterday's `card_events`,
generates, and auto-publishes. Only *what fills `scope_id`* changes as you climb.
```
nightly cron ─► 1. read yesterday's card_events (white × black × judge → won?)
                2. update humor fingerprint[scope_id] = tag histogram of winners
                3. pick seeds: top performers, minus F4-retired cards
                4. prompt your model: seeds + fingerprint + existing-cards (dedupe)
                5. generate 3× target, then RANK candidates vs the fingerprint
                6. publish top third → madlad-generated (tagged, maturity-rated)
                7. log every card + the seed/fingerprint/context it grew from
```

**The ladder (each rung ships independently; higher rungs are opt-in polish, not a rewrite):**
- **Rung 0 — right signal (this is F1's tuple).** No agent yet; just make sure
  `card_events` carries `(white, black, judge, scope_id)`. Everything below depends
  on it and it can't be backfilled.
- **Rung 1 — global fingerprint + generation.** `scope_id = "global"`. Model tags each
  card (`dark`, `absurdist`, `wordplay`, `topical`, `wholesome-subverted`…); the
  fingerprint is a **tag histogram of what won** — a dict, not an ML model. Hand it +
  top seeds to your model, generate, rank, publish. **Ships the full loop with zero
  identity infra** — this is the playtest target.
- **Rung 2 — per-session.** `scope_id = session_id`. Same machinery, events grouped
  per night; the deck can lean into a single session mid-playtest. Near-zero added cost.
- **Rung 3 — per-group memory (the sticky payoff).** `scope_id = group_id` once a
  lightweight persistent group identity exists (a slice of **S0** — the same crew
  rejoins a room). Now the deck *remembers your friends*. This is the distinctive,
  no-other-CAH-clone-does-it product; reached only after the loop is proven on real data.

**Tasks:**
- [ ] Fingerprint builder: aggregate `card_events` winners into `tag_histogram` keyed
      by `scope_id` (start with the single `"global"` key).
- [ ] Card tagging: model tags each card at generation (and backfill-tag `madlad-core`
      once) so histograms have a vocabulary to count over.
- [ ] Model-agnostic generation interface: `generate(seeds, fingerprint, avoid) → cards[]`
      behind a small adapter — swap self-hosted models without touching the pipeline.
- [ ] **Generate-then-rank**, not generate-then-dump: over-generate (~3×), score each
      candidate against the active fingerprint, publish only the top slice.
- [ ] **Auto-publish** into `madlad-generated` (tagged, maturity-rated), isolated from
      `madlad-core`; one flag disables it.
- [ ] Operational hygiene: dedupe vs existing cards, per-run volume caps, full
      provenance log (each card ← its seeds + fingerprint snapshot).

### [F6] Close the loop — measure, prune, re-seed — `M`
**Value:** the agent learns whether *its* cards actually land — and improves, not just accretes.
- [ ] Generated cards accrue their own F1/F2 telemetry (they carry ids like any card).
- [ ] **A/B vs a holdout:** track `madlad-generated` win-rate against `madlad-core`
      win-rate continuously. This is the **only honest answer to "is the agent any
      good?"** — without it you're just adding volume. Works identically at every F5 rung.
- [ ] Prune underperforming/flagged generated cards (F4); feed the survivors back as
      seeds for the next run — the fingerprint tightens toward what wins over time.
- [ ] Guard against monoculture: keep some seed diversity / exploration so the deck
      doesn't collapse into one joke shape as it optimizes.

---

## Suggested sequencing
```
E2.3 (merge) → F0 deploy ──► F1 outcomes ─┐
                            └► F2 flags ───┴─► F3 dashboard + F4 model ─► F5 agent ─► F6 loop
```
Playtest can start after **F0 + F2 (+ F1)** — you get real games with flags and win
data. F5 (the agent) only becomes useful once that data exists, and even then it
climbs the rung ladder: **F5-Rung 1 (global)** is the playtest target; Rungs 2–3
(per-session, per-group) layer on later without a rewrite.

## Open questions
- ~~**card_events vs card_stats** for F1~~ — **decided:** append-only `card_events`
  (carries the humor tuple) + a derived `card_stats` aggregate. The tuple needs the
  flexibility; counters alone can't express context/judge.
- **Where flagging lives in the UX** (hand vs revealed submissions vs post-round) —
  worth a quick playtest of the interaction itself.
- **Generated-pack visibility:** is `madlad-generated` in the default deck during
  playtest, or opt-in? (Recommend: in the deck for playtesters, behind a flag.)
- **Min-plays / thresholds** for win-rate and retirement — tune with real data.
- **When to leave Rung 1** for per-session/per-group taste — gate on real evidence
  the global loop works (F6 A/B) before adding identity infra for scoping.
- **Fingerprint monoculture** — how much exploration/diversity to keep as the deck
  optimizes, so it doesn't collapse into a single joke shape (F6).
