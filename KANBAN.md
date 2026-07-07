# 🃏 Ace Cast - Kanban Board

Status Legend:
- `✅` Done | `🔄` In Progress | `📋` Ready | `🗑️` Deferred

---

## ✅ COMPLETED — Playable MadLad prototype

Ace Cast now has one game that works end-to-end for friends playing in person:
**MadLad**. The lobby, QR join, TV display, and private phone
hands are all wired and covered by tests (`npm test`, 5 suites).

### [C1] ✅ Working MadLad game engine
- [x] Standalone `MadLadGame.js` engine (no half-built abstraction)
- [x] Judge (Card Czar) rotation each round
- [x] Answer submission → anonymous judging → winner + scoring
- [x] Play to a target score, then game over
- [x] Built-in party-friendly deck (`src/game/data/madladCards.js`, ~50 black / ~140 white)
- [x] Deck reshuffles from the discard pile when it runs low
- [x] Handles players joining/leaving mid-game (judge bail restarts the round)
- [x] Unit tests (`tests/madlad_game.test.js`, 15 tests)

### [C2] ✅ Per-player private state
- [x] Players receive their own hand privately (socket-to-socket)
- [x] Spectators (TV + host) only ever see public state — no hand leaks
- [x] Submissions stay anonymous until the judge picks
- [x] End-to-end socket test proves the flow (`tests/socket_e2e.test.js`)

### [C3] ✅ Game lifecycle wiring
- [x] `start-game` validates minimum players and reports errors to the host
- [x] `end-game` handler actually ends the game and returns clients to the lobby
- [x] Player stats: `gamesPlayed` for all, `gamesWon` for the winner only

### [C4] ✅ MadLad client UIs
- [x] Player phone UI: black prompt, tap-to-play hand, judge picker
- [x] TV UI: big prompt, submission reveal, winner highlight, scoreboard
- [x] Host UI: MadLad enabled + selected by default, error + end-game handling

### [C5] ✅ Codebase cleanup
- [x] Removed abandoned parallel track (`GameManagerRefactored`, `socketHandlers`,
      `GameEngineFactory`, `utils/validation`, `BaseGameEngine`)
- [x] Removed the non-functional `PokerGame` stub
- [x] Fixed the 2 stale failing tests

### [C6] ✅ Game registry + enforced engine contract
- [x] Central game registry (`registry.js`) with aliases; UIs read from it
- [x] `BaseGame` abstract class + `validateEngine` (throws on non-conforming engines)
- [x] MadLad & TestGame migrated to the contract; compliance test suite
- [x] Client render asymmetry (`tv.js`/`player.js` `gameType` branches) noted, deferred

---

## 📋 EPIC — Card Platform & Monetization

Cards move into a database (SQLite local, Postgres prod), gain sprite graphics, and
become the monetization: $2–3 packs, tagged + maturity-rated, owned per account.
Full groom (schema, acceptance criteria, sizes, open questions) lives in
`docs/madlad-card-platform-backlog.md`.

**Decisions:** tags + maturity now (leaning-based recs later) · full user accounts ·
mock store first → Stripe later · sprites pre-generated offline (batch SD).

**Build order:** `E1 → E2 → {E3, E6}` and `E1 → E4 → E5 → E6`; E7/E8 later.

### [E1] ✅ Persistence foundation *(shipped — 1.4.0)* — `M`
- [x] Dual-dialect data layer: SQLite (local) + Postgres (prod), one thin repository
- [x] Migration runner + `npm run migrate`; `DATABASE_URL` config; pooled connection
- [x] Tests on in-memory / temp-file SQLite
- [x] Decided: **Knex** (query builder + migrations/seeds)
- [ ] ⏳ Remaining: CI job proving Postgres parity (still outstanding)

### [E2] ✅ Card content database *(shipped — 1.4.0)* — `M`
- [x] `packs` + `cards` + `tags`/`pack_tags` schema (maturity int 0–3); hot-path indexes
- [x] Idempotent seed of `madladCards.js` as the free `madlad-core` pack
- [x] `DeckService.buildDeck({ packIds, maturityMax })`; engine takes an **injected** deck
- [x] `MadLadGame` no longer imports the card file; cards flow as `{id,text}` objects
- [x] `madlad_game.test.js` green on a fixture deck; full round plays from the DB (e2e)

### [E3] Sprite graphics on cards *(needs E2)* — `M`
- [ ] `assets` table + storage (local dir → object storage in prod); `≤256²` sprites
- [ ] Offline `scripts/generate-sprites` SD pipeline (resumable, dry-run, NOT in request path)
- [ ] Render sprite on TV + phone with text-only fallback (touches client render asymmetry)
- [ ] Open Q: SD backend (local ComfyUI/A1111 vs. hosted API), cost/rate limits

### [E4] User accounts *(needs E1; prereq for ownership)* — `L`
- [ ] `users` + auth (email magic-link and/or Google OAuth), sessions, account UI
- [ ] Guests still play by name; login gates only buying/using paid packs

### [E5] Store + mock entitlements *(needs E2 + E4)* — `M`
- [ ] `entitlements` + `orders`; everyone implicitly owns default packs
- [ ] Pack catalog + store UI, browse/filter by tag + maturity
- [ ] Mock "buy" → grant entitlement atomically & idempotently (no real money yet)

### [E6] In-game pack selection *(needs E2 + E5)* — `M`
- [ ] Host multi-selects owned packs at room start; server verifies entitlement
- [ ] Room maturity cap filters the deck; empty selection → `madlad-core`

### [E7] Leaning-based recommendations *(later)* — `M`
- [ ] "Pick your vibe" onboarding; recommend packs by tag/maturity affinity

### [E8] Real payments — Stripe Checkout *(later; needs E5)* — `M`
- [ ] Stripe products mirror packs; **webhook** grants entitlement (source of truth)
- [ ] Refunds → revoke; receipts; swap mock provider for `stripe` behind same flow

### [E9] Content authoring / admin *(nice-to-have)* — `M`
- [ ] UI/CLI to create packs, add cards, set tags/maturity, trigger sprite gen

> ⚠️ **Not yet groomed:** age-gating + content policy for paid, maturity-rated content.
> Real pre-launch work — needs its own story before any edgy pack ships.

---

## 📋 EPIC — Persistent Sessions, History & Scale

Make the game survive restarts, remember past games, and eventually run across
multiple servers. Everything is in-memory today (`GameManager` map; a live
`gameEngine` per room), identity is per-connection (`playerId = socket.id`), and
`fly.toml` runs one machine on purpose. Full groom in
`docs/sessions-and-scale-backlog.md`.

**Prereqs:** E1 (persistence) for S1/S2; E4 (accounts) for durable stats.
**Sequencing:** `E1 → S0 → S1 → S2 (after E4) → S3` (build S3 only once real
concurrency demands it).

### [S0] Stable player identity *(prereq; needs E1)* — `M`
- [ ] Durable, signed player token that outlives `socket.id` (survives reconnect/restart)
- [ ] `identities` table; rooms key players by stable id, `user_id?` linked when E4 lands
- [ ] Guests still get an ephemeral id (no drop-in regression)
- *Linchpin: resume, seat re-attach, and stat attribution all depend on this.*

### [S1] Persistent & resumable sessions *(needs E1 + S0)* — `L`
- [ ] `sessions` + snapshot schema (status, versioned serialized state)
- [x] ✅ Engine contract: optional `serialize()` / `static restore()` + `contract.isResumable()`
      implemented for MadLad + Test (shipped early in E2.3b; round-trip tests pass)
- [ ] Write-through snapshot after each action (async, never blocks gameplay)
- [ ] Lazy rehydrate a room on re-access; re-attach reconnecting players to their seats
- [ ] Reconnect grace window; paused-session TTL → abandoned
- *Open Q: how long a paused game stays resumable; who may resume it.*

### [S2] Session history & stats *(needs E1 + E4)* — `L`
- [ ] Persist completed sessions + `session_players` (scores, placement, winner, packs)
- [ ] Durable per-account stats — migrate the in-memory `gamesPlayed/gamesWon` that
      currently evaporate in `GameRoom.endGame`; guest→account merge
- [ ] History UI (your past games; per-room series); leaderboards later

### [S3] Concurrent sessions across servers *(needs E1 + S1; Redis infra)* — `XL`
- [ ] Socket.IO **Redis adapter** for cross-instance fan-out (config-gated; dev runs solo)
- [ ] **Decide room routing model** (ADR): (a) sticky per-instance ownership *(recommended
      first)* vs (b) shared authoritative state in Redis/PG with per-room locks (uses S1
      serialization)
- [ ] Shared room/session registry so any instance can locate a room
- [ ] `fly.toml` multi-machine + graceful drain (paused-persist owned rooms on shutdown)
- [ ] Multi-instance load/soak test + per-machine capacity numbers
- *Real recurring cost — gate behind actual concurrency demand.*

---

## 📋 EPIC — Card & Hand Game-Feel ("Juice")

Make cards feel like physical objects and the hand feel tactile — seeing what you're
holding and scheming about when to drop the perfect card is core to the fun. Distinct
from E3 (which is *images on* cards); this is look/motion/feel. **Client-only — no
backend/DB/account dependency, so it can ship in parallel with every other track.**
Full groom in `docs/card-hand-gamefeel-backlog.md`.

Today the phone hand is a flat tap-to-play grid and the TV does static swaps; cards are
rendered by duplicated `gameType` branches in `tv.js`/`player.js`. Hands already persist
round-to-round mechanically — the anticipation just isn't *surfaced* yet.

### [J1] Card design system + shared renderer *(foundation)* — `M`
- [ ] Real card face (typography, texture, rounded corners, shadow, card-back); prompt/answer variants
- [ ] One `renderCard()` shared by `tv.js` + `player.js` — kills the client render asymmetry
- [ ] Reserve a sprite region so E3 art drops in without rework

### [J2] Hand feel on the phone *(core of the ask)* — `L`
- [ ] Fanned/overlapping hand, swipe-through with momentum
- [ ] Tap-to-lift + confirm, or drag-up-to-play (decide via device testing); clear "played" state

### [J3] Holding & anticipation affordances *(the "Donkey Cock" moment)* — `M`
- [ ] Reorder hand; **pin/favorite** a card you're saving (marked across rounds)
- [ ] "New this round" tag; optional tasteful glow when a held card fits the prompt

### [J4] Play & reveal animations — `M`
- [ ] Card lifts and flies to the table on submit; submissions flip face-up one at a time
- [ ] Winner card scales + glows, confetti, score ticks up

### [J5] TV board choreography — `M`
- [ ] Deal-in + prompt slam, paced submission reveal, judge spotlight, animated scoreboard

### [J6] Sound & haptics *(optional, high feel-per-effort)* — `S`
- [ ] Card/flip/win sounds + phone haptics; global mute, respects OS silent switch

### [J7] Motion accessibility & performance — `S`
- [ ] Honor `prefers-reduced-motion`; 60fps on mid phones; feature-flag heavy effects

> **Open:** visual direction (minimalist B/W vs. richer themed — ties to E3 art + E5 cosmetic packs).
> **Note:** J1's shared renderer is also what E3.3 (sprites) and E6.1 (pack selection) need.

---

## 📋 EPIC — Playtest Feedback Loop

Closed loop for playtesting soon: **play → capture (flags + wins) → generate/prune
cards → play again.** The enabler already shipped — E2.3 made cards carry ids
through play, so a winning card is knowable by id. Full groom in
`docs/playtest-feedback-loop-backlog.md`.

**Decisions:** flag reasons are **`not_funny` + `broken` only** (no "offensive" — content
is intentionally mature; positive signal = win-rate, not a love button) · the agent
**auto-publishes** into an isolated `madlad-generated` pack · **no content guardrail for
the playtest** · generation runs on **your own models** (model-agnostic).

**Playtest can start after F0 + F2 (+F1).** F5 (agent) only helps once data exists.

### [F0] Deploy DB-backed build on Postgres (Fly) *(critical path)* — `M`
- [ ] Fly Postgres + attach (`DATABASE_URL`); boot-time migrate+seed creates `madlad-core`
- [ ] `/healthz` DB ok; play a real prod game sourced from the DB; update `DEPLOY.md`
- Depends on **E2.3 merged**

### [F1] ✅ Card outcome telemetry *(shipped — 1.5.0)* — `M`
- [x] On `pick-winner`, persist submitted card ids + which won (via `MadLadGame.getLastRoundOutcome()`)
- [x] `card_stats` counters (plays/wins), upsert-increment; written in the server layer, engine stays pure

### [F2] Card flagging — `M`
- [ ] `card_flags` (card_id, reason `not_funny`|`broken`, flagger_id); unique per flagger
- [ ] Phone flag affordance (two reasons); rate-limited endpoint; flagger id = device token (S0-lite)

### [F3] Feedback dashboard — `M`
- [ ] Per-card win-rate (min-plays floor), plays, flag counts; top winners / dead weight / most-flagged; admin-gated

### [F4] Performance model + retirement — `S`
- [ ] `win_rate = wins/plays`; retire on high flag-rate or low win-rate (config thresholds); reversible

### [F5] AI card-generation agent — `L`
- [ ] Batch job: winners as style context → **your model** → new cards
- [ ] Auto-publish into isolated `madlad-generated` pack; model-agnostic interface
- [ ] Dedupe vs existing, volume caps, log each card + its seed

### [F6] Close the loop — `M`
- [ ] Generated cards accrue their own telemetry; prune losers, reseed from winners

---

## 📋 BACKLOG

### [B1] Poker (Texas Hold'em)
- [ ] Real betting rounds, turn order, and hand evaluation
- [ ] Deferred — was a broken stub; needs a proper build if desired

### [B6] Custom deck config
- [ ] JSON-based deck definitions / house rules
- [ ] Load custom decks dynamically
- 🗑️ Largely absorbed by the Card Platform epic (E2 deck data + E6 selection);
      keep only the "house rules" sliver as a later add-on

### [B7] Multiple simultaneous game rooms UI
### [B8] Game replay & highlights
### [B9] Card theme / cosmetic packs 🗑️ superseded by the Card Platform epic (E3 sprites + E5 packs)
### [B10] Tournament modes

---

## 🔎 Nice-to-haves noticed during the MadLad build
- Pick-2 / pick-3 black cards (currently single-blank only)
- "Play again" from the game-over screen without recreating the room
- Reconnect handling if a phone drops mid-round → absorbed into **[S1] / S0** (stable identity + reconnect)

---

*Last updated: 2026-07-06 — reconciled: E1 + E2 shipped (1.4.0), S1 serialize/restore done in E2.3b. Epics on the board: Card Platform (E1–E9), Persistent Sessions & Scale (S0–S3), Card & Hand Game-Feel (J1–J7), Playtest Feedback Loop (F0–F6).*
