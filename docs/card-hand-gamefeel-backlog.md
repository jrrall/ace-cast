# Card & Hand Game-Feel ("Juice") — Backlog (groomed)

Groomed from: "more visual pizzazz for the cards and hands — seeing your hand,
anticipating when/where you'll drop the 'Donkey Cock' card is a huge part of the
experience." This is **game-feel / juice**: making the cards feel like physical
objects and the hand feel tactile and full of scheming potential.

## Not the same as E3
- **E3 (Card Platform)** = *images on* cards (sprites baked per card).
- **This epic (J)** = how cards *look, move, and feel to hold and play* — layout,
  motion, anticipation, celebration. They compose: J1's card face reserves the slot
  E3's sprite drops into.

## Current state
- **Phone hand** (`public/js/player.js`, `public/css/player.css`): a flat
  `madlad-hand` grid of tap-to-play `madlad-white-card` divs. Functional, no motion,
  no sense of "holding" cards.
- **TV** (`public/js/tv.js`, `tv.css`): prompt + submission reveal + winner highlight +
  scoreboard, all static swaps — no dealing, flipping, or celebration.
- **Cards are text-only** and rendered by **duplicated** `gameType==='madlad'` branches
  in `tv.js` and `player.js` (the client render asymmetry flagged in the engine-contract
  work). No card component, no card-back, no animation, no sound/haptics.
- **Mechanically, holding already works:** MadLad refills to a 7-card hand and you play
  one per round, so unplayed cards genuinely carry forward round to round
  (`MadLadGame.refillHand`). The anticipation the user describes is real — it's just not
  *surfaced or satisfying* yet.

## Why this epic is attractive to schedule
**Client-only. No backend, DB, or account dependency.** It can be built independently
and in parallel with the DB (E1/E2) and Sessions (S) tracks — pure player-facing polish
that ships value on its own timeline.

## Dependency spine
```
J1 card design system + shared renderer ──┬─► J2 hand feel ──► J3 holding/anticipation
                                          ├─► J4 play/reveal animations
                                          └─► J5 TV choreography
J6 sound/haptics and J7 motion-a11y/perf apply across all of the above.
```
Legend: `S`≈1–2 days · `M`≈3–5 days · `L`≈1–2 weeks (client, solo).

---

## Epic J — Card & Hand Game-Feel

### [J1] Card design system + shared renderer  — `M`  *(foundation)*
**Value:** cards look like cards, and there's ONE place that renders them.
- [ ] A real card face: typography scale, texture/paper feel, rounded corners, border,
      drop shadow, and a branded **card back**. Black (prompt) vs white (answer) variants.
- [ ] Extract a single `renderCard(card, opts)` used by BOTH `tv.js` and `player.js` —
      kills the duplicated `gameType` render branches (the client asymmetry).
- [ ] Reserve a sprite region in the layout so **E3** art drops in without a re-do.
- [ ] Responsive: legible on a small phone and readable across a room on the TV.

### [J2] Hand feel on the phone  — `L`  *(the core of the ask)*
**Value:** holding your hand is tactile and fun, not a flat grid.
- [ ] Fanned / overlapping hand layout that reads as "cards in hand."
- [ ] Swipe / horizontal scroll through the hand with momentum.
- [ ] Tap-to-lift a card (satisfying raise + focus), then confirm to play — or
      **drag a card up to play** it. Decide tap-confirm vs drag-to-play via device testing.
- [ ] Clear "played / waiting for others" state after you commit.
- [ ] Feels good one-handed on a phone; large tap targets.

### [J3] Holding & anticipation affordances  — `M`  *(the "Donkey Cock" moment)*
**Value:** reward scheming — saving a great card for the perfect prompt.
- [ ] Reorder your hand (drag to arrange).
- [ ] **Pin / favorite** a card you're holding for later — it stays visually marked
      across rounds (the "I'm saving this one" feeling).
- [ ] Subtle "new this round" tag on freshly-dealt cards so you notice what changed.
- [ ] Optional: a gentle hint/glow when a held card would fit the current prompt
      (keep it tasteful — don't play the game for them).

### [J4] Play & reveal animations  — `M`
**Value:** every action has weight and payoff.
- [ ] Card lifts and flies to the table on submit.
- [ ] During judging, submissions **flip face-up one at a time** (suspense).
- [ ] Winner card **scales + glows**, small confetti burst, score **ticks up**.
- [ ] Round transition wipes cleanly to the next prompt.

### [J5] TV board choreography  — `M`
**Value:** the shared screen becomes the show everyone watches.
- [ ] Deal-in animation at round start; prompt "slams" in.
- [ ] Submission flip reveal synced with the judge's pace.
- [ ] Judge spotlight; winner celebration; animated scoreboard re-rank.

### [J6] Sound & haptics  — `S`  *(optional, high feel-per-effort)*
- [ ] Card whoosh / flip / win sounds; phone haptic on select / play / win.
- [ ] Global mute + respects the OS silent switch; no autoplay surprises.

### [J7] Motion accessibility & performance budget  — `S`
- [ ] Honor `prefers-reduced-motion` (swap animations for instant states).
- [ ] 60fps target on mid-range phones; no layout thrash; feature-flag heavy effects.

---

## Open questions
- **Visual direction:** minimalist CAH-style black/white, or a richer themed look? This
  ties into **E3** (sprite art style) and the cosmetic **card packs** (E5/`B9`). Worth a
  quick style exploration before J1 locks the card face.
- **Drag vs tap-to-play:** decide in J2 with real device testing; drag feels great but
  can misfire one-handed.
- **Scope of "hint when a card fits" (J3):** how smart / how subtle before it feels like
  the game is choosing for you.

## Cross-cutting notes
- **J1 is the natural home for the shared card renderer** that E3.3 (sprites) and E6.1
  (pack selection) also need — building it here pays those down too.
- Everything here is `public/js` + `public/css`; no server changes required for J1–J5
  (J6 audio assets are static files). Keep it framework-free to match the current client.
- Test on a real phone early and often — game-feel doesn't show up in unit tests.
