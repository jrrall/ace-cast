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
   capture:  F1 outcomes (plays/wins by card id)               │
             F2 flags (not_funny / broken)                     │
              ▼                                                 │
   store:    F3 per-card stats + dashboard  ◄── F4 perf model  │
              ▼                                                 │
   act:      F5 AI agent → generate winners' style → publish ──┘
             + prune flagged/low performers (F4/F6)
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
**Value:** know which cards actually win.
- [ ] Persist per-card outcomes: on `pick-winner`, record each submitted card id and
      whether it won (and the black card that framed the round).
- [ ] Data model: `card_stats` counters (`card_id`, `plays`, `wins`) updated
      transactionally, or append-only `card_events` + a derived aggregate (decide;
      events are more flexible, counters are simpler for MVP).
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

### [F5] AI card-generation agent — `L`
**Value:** the deck grows itself from what's winning.
- [ ] Batch job (cron/script, like the sprite pipeline — NOT in the request path):
      read top performers + avoid retired cards → hand them to **your model** as
      style context → generate new cards.
- [ ] **Auto-publish** into a dedicated `madlad-generated` pack (tagged, maturity-rated),
      isolated from `madlad-core`; one flag disables it.
- [ ] Model-agnostic interface (swap models without touching the pipeline).
- [ ] Operational hygiene: dedupe generated cards vs existing, per-run volume caps,
      log each generated card + the seed/context it came from.

### [F6] Close the loop — `M`
**Value:** the agent learns whether *its* cards work.
- [ ] Generated cards accrue their own F1/F2 telemetry.
- [ ] Prune underperforming/flagged generated cards (F4); feed winners back as seeds
      for the next generation run.

---

## Suggested sequencing
```
E2.3 (merge) → F0 deploy ──► F1 outcomes ─┐
                            └► F2 flags ───┴─► F3 dashboard + F4 model ─► F5 agent ─► F6 loop
```
Playtest can start after **F0 + F2 (+ F1)** — you get real games with flags and win
data. F5 (the agent) only becomes useful once that data exists.

## Open questions
- **card_events vs card_stats** for F1 (flexibility vs simplicity) — decide at build.
- **Where flagging lives in the UX** (hand vs revealed submissions vs post-round) —
  worth a quick playtest of the interaction itself.
- **Generated-pack visibility:** is `madlad-generated` in the default deck during
  playtest, or opt-in? (Recommend: in the deck for playtesters, behind a flag.)
- **Min-plays / thresholds** for win-rate and retirement — tune with real data.
