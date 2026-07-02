# 🃏 Ace Cast - Kanban Board

Status Legend:
- `✅` Done | `🔄` In Progress | `📋` Ready | `🗑️` Deferred

---

## 📋 BACKLOG

### [B1] Complete PokerGame engine
- [x] Create `PokerGame.js` extending `BaseGameEngine`
- [ ] Card deck logic (52-card deck, betting rounds)
- [ ] Hand evaluation (pair, two-pair, flush, straight, full house, etc.)
- [ ] Player actions: check, call, raise, fold, all-in
- [ ] Pot management and betting rounds
- [ ] Community cards (flop, turn, river)
- [ ] Dealer order and blinds
- [ ] Wire into `GameRoom.startGame()` switch
- [ ] Write tests

### [B2] Complete CAHGame engine
- [ ] Create `CAHGame.js` extending `BaseGameEngine`
- [ ] White card / black card deck structure
- [ ] Round card-curator (judge) rotation
- [ ] Blind voting on TV
- [ ] Scoring: +1 per vote, loser discards white card
- [ ] Custom deck support
- [ ] Wire into `GameRoom.startGame()` switch
- [ ] Write tests

### [B3] Wire up BaseGameEngine (all games use it)
- [x] `BaseGameEngine` is built ✅
- [ ] Ensure PokerGame and CAHGame extend it (not standalone)
- [ ] Utilize `GameEngineFactory.js` for game creation
- [ ] Standardize action/event handler registration across all games

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

_No items done yet — let's knock some out!_

---

*Last updated: 2026-07-01*
