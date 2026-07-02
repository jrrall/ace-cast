# 🃏 Ace Cast - Kanban Board

Status Legend:
- `✅` Done | `🔄` In Progress | `📋` Ready | `🗑️` Deferred

---

## ✅ COMPLETED

### [B1] ✅ Complete PokerGame engine
- [x] Create `PokerGame.js` extending `BaseGameEngine`
- [x] Card deck logic (52-card deck, betting rounds)
- [x] Hand evaluation (pair, two-pair, flush, straight, full house, etc.)
- [x] Player actions: check, call, raise, fold, all-in
- [x] Pot management and betting rounds
- [x] Community cards (flop, turn, river)
- [x] Dealer order and blinds
- [x] Wire into `GameRoom.startGame()` switch
- [ ] Write tests

### [B2] ✅ Complete CAHGame engine
- [x] Create `CAHGame.js` extending `BaseGameEngine`
- [x] White card / black card deck structure
- [x] Round card-curator (judge) rotation
- [x] Blind voting on TV
- [x] Scoring: +1 per vote, loser discards white card
- [x] Custom deck support
- [x] Wire into `GameRoom.startGame()` switch
- [ ] Write tests

### [B3] ✅ Wire up BaseGameEngine (all games use it)
- [x] `BaseGameEngine` is built ✅
- [x] Ensure PokerGame and CAHGame extend it (not standalone)
- [x] Utilize `GameEngineFactory.js` for game creation
- [x] Standardize action/event handler registration across all games

---

## 📋 BACKLOG

### [B4] Real player statistics
- [ ] Increment `gamesPlayed` / `gamesWon` on game end
- [ ] Persist stats across game sessions in room
- [ ] Display stats in player/TV UI
- [ ] Write tests

### [B5] QR code player join
- [ ] Add QR code generation on host page
- [ ] Use `qrcode` npm package
- [ ] Host URL auto-embedded in QR
- [ ] Display on host UI alongside room code

### [B6] Custom deck config
- [ ] JSON-based deck definitions
- [ ] Card type schema
- [ ] House rules configuration
- [ ] Load custom decks dynamically

### [B7] Multiple simultaneous game rooms
- [ ] UI to create & switch rooms
- [ ] Backend support for multi-room routing
- [ ] Host can run multiple rooms

### [B8] Game replay & highlights
- [ ] Hook into `exportData()` on BaseGameEngine
- [ ] Store game history
- [ ] Replay UI component
- [ ] Write tests

### [B9] Card theme / cosmetic packs
- [ ] CSS variable theming system
- [ ] Card back styles
- [ ] UI skin toggles
- [ ] Theme store integration (local or config)

### [B10] Tournament modes
- [ ] Multi-room tournament bracket logic
- [ ] Player movement between rooms
- [ ] Tournament state machine
- [ ] Write tests

---

## ✅ DONE

_PokerGame, CAHGame, and BaseGameEngine wiring complete!_

---

*Last updated: 2026-07-01*
