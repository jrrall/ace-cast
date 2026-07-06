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

---

## 📋 BACKLOG

### [B1] Poker (Texas Hold'em)
- [ ] Real betting rounds, turn order, and hand evaluation
- [ ] Deferred — was a broken stub; needs a proper build if desired

### [B6] Custom deck config
- [ ] JSON-based deck definitions / house rules
- [ ] Load custom decks dynamically

### [B7] Multiple simultaneous game rooms UI
### [B8] Game replay & highlights
### [B9] Card theme / cosmetic packs
### [B10] Tournament modes

---

## 🔎 Nice-to-haves noticed during the MadLad build
- Pick-2 / pick-3 black cards (currently single-blank only)
- "Play again" from the game-over screen without recreating the room
- Reconnect handling if a phone drops mid-round

---

*Last updated: 2026-07-06*
