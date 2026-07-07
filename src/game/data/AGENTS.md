# AGENTS.md — Authoring MadLad cards

Scope: this folder (`src/game/data/`). If you are an AI agent or tool adding cards
to **MadLad**, follow this. The goal is a big, funny, edgy deck — "good, bad, and
indifferent" is fine, but stay inside the one hard content line below.

## Quickstart

1. Edit `madladCards.js`. It exports two arrays:
   - `BLACK_CARDS` — **prompts** (the black card everyone answers).
   - `WHITE_CARDS` — **answers** (the white cards players submit).
2. Append your new entries to the relevant array (don't reorder or dedupe the rest).
3. Run the verify block at the bottom. It must pass before you commit.

```js
// madladCards.js — shape (do not change)
const BLACK_CARDS = [ 'The secret to a happy marriage is ____.', /* … */ ];
const WHITE_CARDS = [ 'A lifetime of regret.', /* … */ ];
module.exports = { BLACK_CARDS, WHITE_CARDS };
```

## Black cards (prompts) — rules

- **Exactly one blank, written as `____`** (four underscores). The engine treats any
  run of 2+ underscores as the blank, but the deck convention is four. **Do not** write
  pick-2 / pick-3 prompts — the engine is single-blank only right now. One `____` per prompt.
- The blank can sit anywhere: start, middle, or end (`'____ ruined Thanksgiving.'` is fine).
- End with a period (or `?`/`!` when the sentence calls for it).
- A prompt should be funny with *many* different answers, not just one setup→punchline pair.

**Good:** `'My therapist went quiet when I brought up ____.'`
**Bad:** `'Pick two: ____ and ____.'` (multi-blank — unsupported)
**Bad:** `'What is the funniest word?'` (no blank — will render with no answer slot)

## White cards (answers) — rules

- A self-contained noun phrase that can drop into a blank and read naturally.
- Capitalize the first letter; end with a period.
- Keep it short (a few words to one line). Specific beats generic — *"A raccoon union rep."*
  lands; *"Something bad."* doesn't.
- Aim for answers that are funny against *lots* of prompts, not one.

**Good:** `'Monetizing my trauma.'` · `'A haunted vape.'` · `'Getting to third base in a Honda Civic.'`
**Bad:** `'Funny.'` (not a noun phrase, not specific) · `'ANSWER'` (formatting)

## String style (JavaScript, not JSON)

- Single-quoted strings. **Escape apostrophes** as `\'` — e.g. `'What\'s my toxic trait? ____.'`.
- Use straight quotes for escaping; a literal curly apostrophe `’` inside the string is
  also fine (no escape needed) but be consistent within an entry.
- One entry per line, trailing comma after each. Don't leave a dangling non-comma line.

## The one hard content line (non-negotiable)

Edgy, crude, dark, raunchy, absurd, mean-in-a-fun-way — all welcome. But **never**:

- Slurs, or jokes that punch at a protected group (race, religion, gender, sexuality,
  disability, etc.).
- Real, named private individuals (public-figure *archetypes* like "a man named Chad" are fine).
- Sexual content involving minors — hard stop, no exceptions.
- Content that only works as genuine hate rather than a joke.

If a card needs a real slur or a real person's name to be funny, it isn't going in. This
keeps the deck "adult party game," not "gets the repo taken down."

## Tone / maturity

The deck skews **mature** (roughly maturity `2–3` in the planned pack model — see
`docs/madlad-card-platform-backlog.md`). Four registers to draw from; mix them:

- **Raunchy** — sex, bodily functions, bad decisions.
- **Dark** — death, dysfunction, existential dread, played for laughs.
- **Absurd** — surreal, escalating, non-sequitur.
- **Burnout** — rent, gig economy, therapy-speak, doomscrolling.

## Don't

- Don't change the export shape, variable names, or `module.exports`.
- Don't add duplicates (exact-string dupes fail the verify check).
- Don't add empty strings or whitespace-only entries.
- Don't add multi-blank prompts (see above).
- Don't reformat or reorder existing entries in the same change — append only.

## Verify before you commit (must pass)

From the repo root:

```bash
# 1. Parses, counts, and structural rules
node -e '
const c = require("./src/game/data/madladCards");
const b = c.BLACK_CARDS, w = c.WHITE_CARDS;
const oneBlank = (s) => (s.match(/_{2,}/g) || []).length === 1;
const bad = b.filter((s) => !oneBlank(s));
const empty = [...b, ...w].filter((s) => !s || !s.trim());
const dupB = b.length - new Set(b).size;
const dupW = w.length - new Set(w).size;
console.log("black:", b.length, "white:", w.length);
console.log("prompts without exactly one blank:", bad.length, bad.slice(0,5));
console.log("empty entries:", empty.length, "dupes b/w:", dupB, dupW);
if (bad.length || empty.length || dupB || dupW) { console.error("FAIL"); process.exit(1); }
console.log("OK");
'

# 2. Lint (Airbnb base) — must be clean
npx eslint src/game/data/madladCards.js

# 3. Nothing else broke
npm test
```

All three must be green. If you added a lot of cards, skim a `git diff` for accidental
edits to existing lines.

## Roadmap note

Today cards are plain strings in `madladCards.js` and the engine imports them directly.
Per `docs/madlad-card-platform-e1-e2-spec.md`, cards will move into a database (packs +
per-card `maturity_rating` + tags), and `madladCards.js` becomes the **seed** for the
default `madlad-core` pack. Until that lands, this file is the source of truth — keep it
clean and well-formed so the future seed import is trivial.
