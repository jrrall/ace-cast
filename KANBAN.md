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

### [E1] Persistence foundation *(blocks everything)* — `M`
- [ ] Dual-dialect data layer: SQLite (local) + Postgres (prod), one thin repository
- [ ] Migration runner + `npm run migrate`; `DATABASE_URL` config; pooled connection
- [ ] Tests on in-memory SQLite; CI job proves Postgres parity
- [ ] Open Q: Knex (query builder) vs. `better-sqlite3`+`pg` — decide & document

### [E2] Card content database *(needs E1)* — `M`
- [ ] `packs` + `cards` schema with **tags + maturity**; hot-path indexes
- [ ] Idempotent seed of today's `madladCards.js` as the free `madlad-core` pack
- [ ] `DeckService.buildDeck({ packIds, maturityMax })`; engine takes an **injected**
      deck (stays pure/testable) instead of importing the card file
- [ ] Existing `madlad_game.test.js` stays green on a fixture deck

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
- Reconnect handling if a phone drops mid-round

---

*Last updated: 2026-07-06 — added Card Platform & Monetization epic (E1–E9)*
