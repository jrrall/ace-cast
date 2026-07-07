# MadLad — Card Platform & Monetization Backlog (groomed)

Groomed from: simple card/question DB · sprite graphics on cards · $2–3 card packs
that fit "your leaning" · persistence (SQLite local, Postgres prod).

**Decisions locked during grooming**
- **Content model:** cards & packs carry freeform **tags + a maturity rating** now.
  "Leaning"-based *recommendation* is deferred to a later story once data exists.
- **Identity:** **full user accounts** (email/OAuth) — durable, cross-device
  ownership. This is a prerequisite epic before anything sells.
- **Payments:** **mock store first** (catalog + buy flow + entitlement grant against
  a stubbed payment); real **Stripe Checkout** is a follow-up story.
- **Sprites:** assumed **offline/batch pre-generated** (SD run out-of-band, assets
  baked per card), not generated at runtime. Flag if you want live generation.

## Current state (why these stories exist)
- Cards are hardcoded string arrays in `src/game/data/madladCards.js`
  (`BLACK_CARDS` prompts w/ `____`, `WHITE_CARDS` answers). `MadLadGame` imports them
  directly at construction.
- **No persistence layer at all** — rooms are ephemeral, players are name+socket only.
- **No accounts, no assets, no payments.**

---

## Dependency spine (build order)

```
E1 DB foundation ──┬─► E2 Card content DB ──┬─► E3 Sprites on cards
                   │                        └─► E6 In-game pack selection ─► (later) E7 recommendations
                   └─► E4 User accounts ──► E5 Packs, store & mock entitlements ─┬─► E6
                                                                                 └─► (later) E8 Stripe
```

Legend: `S`≈1–2 days · `M`≈3–5 days · `L`≈1–2 weeks (rough, solo).

---

## Epic E1 — Persistence foundation  *(blocks everything)*

### [E1.1] Data layer: SQLite (local) + Postgres (prod)  — `M`
**Value:** one persistence layer both cards and accounts build on.
- [ ] Pick a dual-dialect approach (recommend **Knex** query builder + migrations,
      or `better-sqlite3` + `pg` behind a thin repository). Decide & document.
- [ ] `DATABASE_URL` config: default `sqlite://./data/ace-cast.db` locally,
      Postgres in production (Fly). Wire into `src/utils/config`.
- [ ] Connection/pool singleton + graceful shutdown.
- [ ] Migration runner + a `npm run migrate` script; runs on boot in prod.
- [ ] Health check surfaces DB connectivity.
- [ ] `.gitignore` the local `data/*.db`; document setup in README/DEPLOY.
- [ ] Tests run against SQLite in-memory; a CI job spins Postgres to prove parity.
**Open Q:** ORM vs. query-builder vs. raw — locked to whatever E1.1 chooses; keep it thin.

---

## Epic E2 — Card content database  *(depends on E1)*

### [E2.1] Card + pack schema & migrations  — `M`
**Value:** cards live in a DB with tags/maturity instead of a JS file.
- [ ] `packs`: id, slug, name, description, game_id, price_cents, is_default,
      maturity_max, published, cover_asset_id?, created_at.
- [ ] `cards`: id, game_id, kind (`prompt`|`answer`), text, blanks (int, default 1),
      pack_id (FK), maturity, sprite_asset_id? (nullable), created_at.
- [ ] `tags` + `card_tags` (or a JSON `tags` column — keep simple; decide in E2.1).
- [ ] Indexes for the hot query: cards by (game_id, kind, pack_id, maturity).

### [E2.2] Seed the existing MadLad deck as the default free pack  — `S`
**Value:** zero content regression; the current deck becomes real data.
- [ ] Idempotent seed importing `madladCards.js` into a `madlad-core` pack
      (`is_default=true`, `price_cents=0`, maturity=teen/mature — pick one).
- [ ] `blanks=1` for all current prompts (matches today's single-blank build).
- [ ] Seed runs in dev bootstrap and prod migration.

### [E2.3] Deck service — engine reads cards from the DB  — `M`
**Value:** `MadLadGame` stops importing the static file.
- [ ] `DeckService.buildDeck({ packIds, maturityMax })` returns `{ prompts, answers }`.
- [ ] `MadLadGame` receives a deck (via `options`) instead of importing cards —
      keep the engine pure/testable (inject the deck, don't have it hit the DB).
- [ ] Default room with no pack selection → uses `madlad-core`.
- [ ] Existing `madlad_game.test.js` stays green (feed it a fixture deck).
- [ ] Keep `madladCards.js` as the seed source only (or delete after seed proven).

---

## Epic E3 — Sprite graphics on cards  *(depends on E2; independent of accounts)*

### [E3.1] Asset model & storage  — `M`
- [ ] `assets`: id, kind (`sprite`), storage_key/url, width, height, sd_prompt,
      sd_model, checksum, created_at. `cards.sprite_asset_id` FKs here.
- [ ] Storage: local `public/assets/sprites/` in dev; object storage (S3/Fly Volumes)
      in prod. One interface, two backends.
- [ ] Sprites are small (e.g. ≤256², optimized PNG/WebP) — "simple sprites."

### [E3.2] Offline SD generation pipeline  — `M`
- [ ] A `scripts/generate-sprites` job: takes cards lacking a sprite, calls a Stable
      Diffusion endpoint with a per-card/style prompt, writes the asset, links it.
- [ ] Deterministic, resumable, rate-limited; dry-run mode. **Not** in the request path.
- [ ] Style guardrails so a pack's sprites look cohesive (seed/style token per pack).
**Open Q:** which SD backend (local Automatic1111/ComfyUI vs. hosted API)? cost/rate limits.

### [E3.3] Render sprites on cards (client)  — `M`
**Value:** cards show their sprite on TV + phone.
- [ ] Public/player state includes `spriteUrl` per card where present.
- [ ] `tv.js` and `player.js` render the sprite (graceful fallback to text-only).
- [ ] ⚠️ Touches the known **client render asymmetry** (`gameType==='madlad'` branches).
      Consider a tiny card-render helper shared by tv/player while here.

---

## Epic E4 — User accounts  *(depends on E1; prerequisite for ownership)*

### [E4.1] Auth & user model  — `L`
**Value:** a durable identity that can own packs across devices.
- [ ] `users`: id, email, display_name, auth_provider, provider_id, created_at.
- [ ] Login: email magic-link and/or OAuth (Google) — pick MVP set.
- [ ] Server sessions/JWT; CSRF-safe; secure cookies in prod.
- [ ] Account UI: sign in/out, "my account".
- [ ] Rate limiting + basic abuse protection on auth endpoints.

### [E4.2] Link a game player to an account (optional at join)  — `S`
**Value:** connect the ephemeral room player to the logged-in buyer.
- [ ] Signed-in host's room can use their entitled packs.
- [ ] Guests still join by name (no forced login to *play*) — login gates *buying/using* paid packs.

---

## Epic E5 — Packs, store & entitlements (mock payment)  *(depends on E2 + E4)*

### [E5.1] Entitlement model & checks  — `M`
- [ ] `entitlements`: id, user_id, pack_id, source (`default`|`purchase`|`grant`),
      acquired_at, order_id?. Unique (user_id, pack_id).
- [ ] Everyone implicitly owns `is_default` packs.
- [ ] `EntitlementService.ownedPackIds(userId)` + `canUsePack(userId, packId)`.

### [E5.2] Pack catalog & store UI  — `M`
- [ ] Store lists published packs: name, blurb, cover, tags, maturity, price, owned-state.
- [ ] Filter/browse by tag + maturity (the data that later powers recommendations).
- [ ] Pack detail page with sample cards.

### [E5.3] Mock purchase → grant entitlement  — `S`
**Value:** exercise the whole buy→own→use flow with no real money.
- [ ] "Buy" creates an `orders` row (provider=`mock`, status=`paid`) and grants the
      entitlement atomically.
- [ ] Idempotent; re-buying an owned pack is a no-op.
- [ ] Clear "this is a mock purchase" affordance in non-prod.

---

## Epic E6 — In-game pack selection  *(depends on E2.3 + E5.1)*

### [E6.1] Choose packs when starting a MadLad room  — `M`
**Value:** owned packs actually change what you play with.
- [ ] Host UI: pick from `madlad-core` + owned paid packs; multi-select.
- [ ] Room-level maturity cap (filter cards above the cap).
- [ ] `DeckService` builds the deck from selected packs; empty selection → default.
- [ ] Server validates the host is entitled to each selected pack (no spoofing).

---

## Later / follow-up epics

### [E7] Leaning-based recommendations  — `M` *(depends on E5 data + E4)*
- [ ] "Pick your vibe" onboarding → recommend packs by tag/maturity affinity.
- [ ] "Because you like X" on the store.

### [E8] Real payments — Stripe Checkout  — `M` *(depends on E5.3)*
- [ ] Stripe products/prices mirror the pack catalog.
- [ ] Checkout session + **webhook** grants entitlement on `checkout.session.completed`
      (webhook is the source of truth, not client redirect).
- [ ] Order reconciliation, refunds → revoke entitlement, receipts.
- [ ] Swap the mock provider for `stripe` behind the same `orders`/entitlement flow.

### [E9] Content authoring / admin  — `M` *(nice-to-have)*
- [ ] Internal UI or CLI to create packs, add cards, set tags/maturity, trigger sprite gen.
- [ ] Supersedes hand-editing `madladCards.js`.

---

## Cross-cutting notes
- **Maturity taxonomy** must be decided once in E2.1 (e.g. `family|teen|mature|explicit`)
  and reused by cards, packs, room caps, and recommendations.
- **Keep the engine pure:** inject decks into `MadLadGame`; never let the engine touch
  the DB directly (preserves fast unit tests).
- **Client asymmetry:** E3.3 and E6.1 both touch `tv.js`/`player.js`; good moment to
  extract a shared card renderer (the deferred item from the contract work).
- **Legal/content:** paid, maturity-rated, possibly edgy user-facing content → age
  gating + content policy are real work; scope before launch (not groomed here).
