# E1 + E2 Implementation Spec — Persistence Foundation & Card Content DB

Implementation-ready design for the first two epics of the Card Platform
(`docs/madlad-card-platform-backlog.md`). Scope: a dual-dialect persistence
layer (SQLite local / Postgres prod) and moving MadLad cards out of a hardcoded
JS file into that database, read through a deck service into a still-pure engine.

**Out of scope here** (later epics, but the schema is designed to accept them):
sprite assets (E3), users/auth (E4), entitlements/orders (E5).

---

## 1. Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| DB access library | **Knex** (`knex` + `better-sqlite3` + `pg`) | One query builder + migration runner across both dialects; minimal, well-trodden. Avoids hand-writing two SQL variants. |
| Dialect selection | From `DATABASE_URL` scheme (`sqlite:` vs `postgres:`) | Same build local and prod; no code branching beyond connection config. |
| Migrations | Knex migrations, run on boot (idempotent) + `npm run migrate` | Prod container migrates itself; devs get one command. |
| Maturity | **integer `maturity_rating` 0–3** (`0 family · 1 teen · 2 mature · 3 explicit`) | Integer makes the room cap a trivial `WHERE maturity_rating <= :cap`; labels live in code. |
| Pack tags | normalized `tags` + `pack_tags` | Packs are the browsable/filterable unit (E5.2); normalized keeps that query dialect-portable. |
| Card tags | **deferred** (no column yet) | No E2/E5 story consumes per-card tags; cards inherit pack context. Add when a story needs it (YAGNI). |
| Deck shape | `buildDeck()` returns **card objects** `{id,text,…}`, not bare strings | Forward-compatible with E3 sprites (need card id); pay the engine refactor once, now. |
| Engine ↔ DB | Engine never touches the DB; deck is **injected** via `options.deck` | Keeps `MadLadGame` a pure unit; DB access stays in the async socket/service layer. |

**Still open (decide at implementation time, low-risk):**
- Default pack maturity for `madlad-core` (recommend `2 = mature`, matching the current deck's tone).
- Whether prod runs migrations on boot or as a separate release step (recommend on-boot; it's idempotent and the app is a single Fly machine).

---

## 2. Dependencies

```
npm i knex better-sqlite3 pg
```
- `knex` — query builder + migrations/seeds.
- `better-sqlite3` — synchronous SQLite driver (fast, simplest for a single-process app).
- `pg` — Postgres driver for prod.

All are prod dependencies (migrations run in the prod container). Node 22 / Alpine:
`better-sqlite3` and `pg` ship prebuilt binaries for `node:22-alpine`; if a build
is needed, add `python3 make g++` as a builder stage (note in the Dockerfile task).

---

## 3. Config additions (`src/utils/config.js`)

Add a `db` block; keep the existing env-driven style.

```js
db: {
  // sqlite://./data/ace-cast.db locally; postgres://… in prod (Fly secret).
  url: process.env.DATABASE_URL || 'sqlite://./data/ace-cast.db',
  // Run migrations automatically on server boot (idempotent).
  migrateOnBoot: process.env.DB_MIGRATE_ON_BOOT !== 'false',
  pool: { min: toInt(process.env.DB_POOL_MIN, 0), max: toInt(process.env.DB_POOL_MAX, 10) },
},
```

Helper to translate `url` → a Knex client config (dialect from scheme):

```js
config.getKnexConfig = () => {
  const url = config.db.url;
  if (url.startsWith('sqlite:')) {
    const filename = url.replace(/^sqlite:(\/\/)?/, '') || './data/ace-cast.db';
    return {
      client: 'better-sqlite3',
      connection: { filename },
      useNullAsDefault: true,
      pool: {
        min: 0,
        max: 1, // better-sqlite3 is synchronous/single-connection
        // Enforce FKs on every SQLite connection.
        afterCreate: (conn, done) => conn.pragma('foreign_keys = ON', done ? () => done(null, conn) : undefined),
      },
    };
  }
  return { client: 'pg', connection: url, pool: config.db.pool };
};
```

(SQLite `afterCreate` FK pragma exact form to be verified against the `better-sqlite3`
Knex adapter during implementation — it exposes `.pragma()` synchronously.)

---

## 4. Module layout

```
src/db/
  index.js          # the Knex singleton + connect()/migrate()/health()/close()
  knexfile.js       # Knex CLI config (migrations/seeds dirs, per-env from config)
  migrations/
    20260707_0001_packs_cards.js
    20260707_0002_tags.js
  seeds/
    madlad_core.js  # seeds the default pack from madladCards.js
src/content/
  PackRepository.js
  CardRepository.js
  DeckService.js
```

`knexfile.js` drives the `knex` CLI (`npx knex migrate:latest`); `src/db/index.js`
is what the app imports at runtime. Both derive from `config.getKnexConfig()` so
there is a single source of truth.

### `src/db/index.js` (shape)
```js
const knexLib = require('knex');
const config = require('../utils/config');

let knex = null;

function db() {
  if (!knex) knex = knexLib(config.getKnexConfig());
  return knex;
}
async function migrateToLatest() { await db().migrate.latest(); }
async function seedRun()        { await db().seed.run(); }
async function health()         { await db().raw('select 1'); return true; }
async function close()          { if (knex) { await knex.destroy(); knex = null; } }

module.exports = { db, migrateToLatest, seedRun, health, close };
```

---

## 5. Schema (E2.1 migrations)

### Migration `0001_packs_cards`
```js
exports.up = async (knex) => {
  await knex.schema.createTable('packs', (t) => {
    t.increments('id').primary();
    t.string('slug').notNullable().unique();
    t.string('name').notNullable();
    t.text('description');
    t.string('game_id').notNullable().index();
    t.integer('price_cents').notNullable().defaultTo(0);
    t.boolean('is_default').notNullable().defaultTo(false);
    t.integer('maturity_max').notNullable().defaultTo(3);   // 0–3
    t.boolean('published').notNullable().defaultTo(true);
    t.integer('cover_asset_id').nullable();                 // FK added in E3
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('cards', (t) => {
    t.increments('id').primary();
    t.string('game_id').notNullable();
    t.enu('kind', ['prompt', 'answer']).notNullable();
    t.text('text').notNullable();
    t.integer('blanks').notNullable().defaultTo(1);
    t.integer('pack_id').notNullable()
      .references('id').inTable('packs').onDelete('CASCADE');
    t.integer('maturity_rating').notNullable().defaultTo(1); // 0–3
    t.integer('sprite_asset_id').nullable();                 // FK added in E3
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['game_id', 'kind', 'pack_id'], 'idx_cards_deck');
    t.index(['pack_id'], 'idx_cards_pack');
  });
};
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('cards');
  await knex.schema.dropTableIfExists('packs');
};
```
> `t.enu` renders as a `CHECK` on SQLite and a native/`varchar+check` on PG — portable.
> Booleans store as `0/1` on SQLite; Knex normalizes reads.

### Migration `0002_tags`
```js
exports.up = async (knex) => {
  await knex.schema.createTable('tags', (t) => {
    t.increments('id').primary();
    t.string('slug').notNullable().unique();
    t.string('label').notNullable();
  });
  await knex.schema.createTable('pack_tags', (t) => {
    t.integer('pack_id').notNullable().references('id').inTable('packs').onDelete('CASCADE');
    t.integer('tag_id').notNullable().references('id').inTable('tags').onDelete('CASCADE');
    t.primary(['pack_id', 'tag_id']);
  });
};
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('pack_tags');
  await knex.schema.dropTableIfExists('tags');
};
```

**Forward-compat note:** `cover_asset_id` / `sprite_asset_id` are plain nullable
integers now; E3 adds the `assets` table and the FK constraints (and E4/E5 add
`users`/`entitlements`/`orders`). Nothing here blocks those.

---

## 6. Repositories & DeckService (E2.3)

### `PackRepository`
```
getBySlug(slug)                 -> pack | null
listByGame(gameId, {publishedOnly=true}) -> pack[]
getDefault(gameId)              -> pack | null   // is_default = true
```

### `CardRepository`
```
listForDeck({ gameId, packIds, maturityMax }) -> card[]
   // WHERE game_id=? AND pack_id IN (?) AND maturity_rating <= ?
```

### `DeckService.buildDeck({ gameId, packIds, maturityMax })`
Async. Resolves pack ids (default pack when `packIds` empty), loads cards, splits
by `kind`, returns:
```js
{
  prompts: [{ id, text, blanks }],   // 'prompt' cards
  answers: [{ id, text }],           // 'answer' cards
}
```
- Empty/unknown `packIds` → fall back to the game's default pack.
- Throws a clear error if a resolved deck has 0 prompts or 0 answers (mis-seed guard).
- E3 enriches each object with `spriteUrl`; no signature change.

### Engine injection (`MadLadGame`)
`MadLadGame` stops importing `madladCards.js`. It reads `options.deck`:
```js
constructor(room, options = {}) {
  super(room, options);
  const deck = options.deck || { prompts: [], answers: [] };
  this.blackPile = this.shuffle(deck.prompts.slice());  // now objects
  this.drawPile  = this.shuffle(deck.answers.slice());
  …
}
```
**Required engine changes (the real churn in E2.3):**
- Hands, `drawPile`, `discardPile`, and `submissions` carry card **objects**
  `{id,text}` (answers) / prompts `{id,text,blanks}` instead of bare strings.
- Everywhere the code currently uses a card string, use `card.text` for display and
  keep `card.id` for later (sprites, dedupe). `blanks` already exists per prompt.
- `getPublicState`/`getStateForPlayer` emit `{ id, text }` per card (client reads
  `.text` today; `.spriteUrl` arrives in E3).
- Keep `MIN_PLAYERS`, judge rotation, scoring, reshuffle logic unchanged.

### Socket wiring (`src/server/index.js`, `start-game` handler)
Deck-building is async and must precede the synchronous `room.startGame`:
```js
socket.on('start-game', async ({ gameType, options }) => {
  if (socket.deviceType !== 'host') return;
  const room = gameManager.getRoom(socket.roomCode);
  if (!room) return;
  try {
    const game = registry.getGame(gameType);
    let injected = options || {};
    if (game && game.cardBacked) {
      const deck = await DeckService.buildDeck({
        gameId: game.id,
        packIds: options?.packIds || [],          // E6 will populate this
        maturityMax: options?.maturityMax ?? game.defaultMaturityMax ?? 3,
      });
      injected = { ...injected, deck };
    }
    room.startGame(gameType, injected);
  } catch (error) {
    socket.emit('error', { message: error.message });
    return;
  }
  io.to(socket.roomCode).emit('game-started', { gameType });
  broadcastGameState(room);
});
```
- Registry gains an optional `cardBacked: true` flag on the `madlad` entry (Test
  game stays deck-less). `startGame` remains synchronous and engine stays pure.
- `options.packIds` is unused until E6; `[]` → default pack keeps today's behavior.

---

## 7. Seeding the default pack (E2.2)

`src/db/seeds/madlad_core.js` — idempotent:
1. Upsert a pack `slug='madlad-core'` (`game_id='madlad'`, `is_default=true`,
   `price_cents=0`, `maturity_max=2`, `published=true`).
2. If that pack has 0 cards, bulk-insert from `madladCards.js`:
   - each `BLACK_CARDS` string → `{kind:'prompt', text, blanks:1, maturity_rating:2}`
   - each `WHITE_CARDS` string → `{kind:'answer', text, maturity_rating:2}`
3. Re-running is a no-op (guarded by the card-count check / slug uniqueness).

`madladCards.js` stays in the tree as the **seed source of record**; the engine no
longer imports it. (Optionally add a `scripts/reseed` later; not required for E2.)

---

## 8. Server bootstrap changes (E1.1)

Today `src/server/index.js` calls `server.listen` at module load. Introduce an
async startup without breaking the test that imports the module.

```js
const dbmod = require('../db');

async function start() {
  if (config.db.migrateOnBoot) await dbmod.migrateToLatest();
  await dbmod.seedRun();                 // idempotent default-pack seed
  await new Promise((res) => server.listen(PORT, config.server.host, res));
  logStartupBanner();
}

if (require.main === module) {
  start().catch((err) => { console.error('Startup failed', err); process.exit(1); });
}

module.exports = { app, server, io, start };
```
- **`/healthz`**: add a DB probe (best-effort, non-fatal):
  ```js
  app.get('/healthz', async (req, res) => {
    let dbOk = false;
    try { await dbmod.health(); dbOk = true; } catch { /* report false */ }
    res.status(dbOk ? 200 : 503).json({ status: dbOk ? 'ok' : 'degraded', db: dbOk, rooms: gameManager.getRoomCount(), uptime: process.uptime() });
  });
  ```
- **`shutdown()`**: add `await dbmod.close()` before `process.exit(0)`.
- **Integration risk — the e2e test:** `tests/socket_e2e.test.js` (`beforeAll`,
  lines ~58–70) requires `../src/server/index`, then reads `mod.server`/`mod.io` and
  waits on `server.listening` / `server.once('listening')` — i.e. it depends on the
  listen-on-require side effect. After moving `listen` into `start()`, `server.listening`
  is `false` and `'listening'` never fires, so the test hangs. **Required change:**
  `beforeAll` must `await mod.start()` (which migrates+seeds against in-memory SQLite,
  then listens), and `afterAll` must `server.close()` **and** `await db.close()`. If
  preferred, keep a compat shim that auto-starts unless `NODE_ENV==='test'`.

---

## 9. Test strategy

Goal: fast, hermetic, and the engine stays a pure unit.

- **Engine tests unchanged in spirit:** `madlad_game.test.js` feeds a **fixture deck**
  object instead of relying on the imported card file:
  ```js
  const deck = { prompts: [{id:1,text:'A ____.',blanks:1}, …], answers: [{id:10,text:'x'}, …] };
  new MadLadGame(makeRoom(makePlayers(3)), { deck });
  ```
  No DB in engine tests. Update the existing tests to pass a deck and assert on
  `card.text` where they currently assert on strings.
- **DB/repo/DeckService tests:** new `tests/deck_service.test.js` +
  `tests/content_repositories.test.js` run against **in-memory SQLite**
  (`DATABASE_URL=sqlite://:memory:`), migrating + seeding in `beforeAll`:
  ```js
  process.env.DATABASE_URL = 'sqlite://:memory:';
  const db = require('../src/db');
  beforeAll(async () => { await db.migrateToLatest(); await db.seedRun(); });
  afterAll(async () => { await db.close(); });
  ```
  (`:memory:` is per-connection; with `better-sqlite3` max-pool=1 this is stable.
  If flakiness appears, use a temp file DB under the OS tmpdir and delete in `afterAll`.)
- **`tests/setup.js`**: default `DATABASE_URL` to in-memory if unset, so no test
  ever touches the dev `./data` file.
- **⚠️ `jest.resetModules()` gotcha:** `tests/setup.js` runs `jest.resetModules()` in
  `afterEach`, which drops the cached `src/db` module — and with it the `knex`
  singleton and any `:memory:` DB. For DB suites, either (a) require `src/db` **inside**
  `beforeAll` and migrate/seed there (fresh instance per file is fine), or (b) use a
  temp **file** DB (`sqlite://<tmpdir>/test-<n>.db`) so data survives a module reset
  within the file, deleting it in `afterAll`. Do **not** assume a module-scoped `db`
  handle persists across tests in the same file.
- **CI parity job:** add a matrix leg / job that spins a Postgres service container
  and runs the repo/DeckService tests with `DATABASE_URL=postgres://…` to prove the
  migrations and queries are dialect-portable. Keep the default unit run on SQLite.
- **Full suite must stay green:** `registry`, `game_manager`, `game_room`,
  `madlad_game` (updated to decks), `test_game`, `contract`, plus the new DB tests.

---

## 10. Deployment (E1.1)

- **Local:** default `sqlite://./data/ace-cast.db`. Add `data/` (and `*.db*`) to
  `.gitignore`; `start()` migrates+seeds on boot, so a fresh clone just works.
- **Prod (Fly):** provision Postgres (`fly postgres create` + `fly postgres attach`,
  which sets the `DATABASE_URL` secret) and confirm `DATABASE_URL` is `postgres://…`.
  The single always-on machine (fly.toml) needs no Redis for this epic.
- **Dockerfile:** migrations run on boot via `start()`, so no separate step is
  strictly required. If `better-sqlite3`/`pg` need compilation on Alpine, add a
  builder stage with `apk add --no-cache python3 make g++` and copy `node_modules`.
  (SQLite in prod isn't used, but the driver is still installed; ensure it builds.)
- **Volume (optional):** only needed if you ever run SQLite in prod; not required
  when Postgres is attached.
- Update `DEPLOY.md` / `README.md` with the Postgres provisioning + `npm run migrate`.

---

## 11. Task breakdown (PR-sized, ordered)

1. **E1.1a — deps + config + db module.** Add `knex/better-sqlite3/pg`; `config.db`
   + `getKnexConfig()`; `src/db/index.js` + `knexfile.js`; `npm run migrate` script;
   `.gitignore data/`. *Verify:* `npm run migrate` creates an empty DB locally.
2. **E2.1 — schema migrations.** `0001_packs_cards`, `0002_tags`. *Verify:* migrate
   up/down clean on both SQLite and (CI) Postgres.
3. **E2.2 — seed.** `seeds/madlad_core.js` from `madladCards.js`; wire `seedRun()`.
   *Verify:* seed is idempotent; card counts match the source arrays.
4. **E2.3a — repos + DeckService.** `PackRepository`, `CardRepository`,
   `DeckService.buildDeck`; unit tests on in-memory SQLite. *Verify:* default-pack
   fallback + maturity filter + empty-deck guard.
5. **E2.3b — engine injection.** `MadLadGame` reads `options.deck` (card objects);
   update `madlad_game.test.js` to fixture decks. *Verify:* engine suite green, no
   DB import in the engine.
6. **E2.3c — socket wiring.** `cardBacked` flag on the madlad registry entry; async
   `start-game` builds+injects the deck; `start()` bootstrap; `/healthz` DB probe;
   `shutdown` closes the pool; fix `socket_e2e` startup. *Verify:* play a full round
   end-to-end (via the e2e test) sourced from the DB.
7. **E1.1b — CI Postgres parity job + docs.** *Verify:* repo/DeckService tests pass
   on Postgres in CI; `DEPLOY.md` updated.

---

## 12. Acceptance criteria (rolls up E1.1 + E2.*)

- [ ] App boots against SQLite locally with no manual DB setup (auto migrate+seed).
- [ ] `DATABASE_URL=postgres://…` boots against Postgres with the same code path.
- [ ] `packs`/`cards`/`tags`/`pack_tags` exist; `madlad-core` seeded, `is_default`,
      free, with all current prompts/answers; seed is idempotent.
- [ ] `MadLadGame` no longer imports `madladCards.js`; it plays from an injected deck.
- [ ] A real MadLad game (host → start → round) draws its cards from the DB.
- [ ] `DeckService` filters by pack + `maturity_rating <= cap` and falls back to the
      default pack on empty selection.
- [ ] Engine unit tests run with fixture decks (no DB); full Jest suite green on SQLite.
- [ ] CI proves migration/query parity on Postgres.
- [ ] `/healthz` reports DB connectivity; graceful shutdown closes the pool.

## 13. Risks / watch-items
- **Engine object-refactor blast radius** (E2.3b) is the biggest single change —
  strings → `{id,text}` through hands/submissions/state. Land it behind the passing
  engine suite; that's the safety net.
- **`listen`-on-require → `start()`** must not break `socket_e2e`; treat as a first-
  class task, not an afterthought.
- **Native module builds** (`better-sqlite3`) on `node:22-alpine` — validate the
  image builds in CI before relying on it in prod.
- **`:memory:` SQLite per-connection** — pinned by max-pool=1; fall back to a tmp
  file DB if any cross-connection test flakiness appears.
```
