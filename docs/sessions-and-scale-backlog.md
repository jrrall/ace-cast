# Persistent Sessions, History & Scale — Backlog (groomed)

Groomed from: "I want this to do multiple sessions of the game." Selected scope:
**persistent/resumable sessions**, **session history & stats**, **concurrent
sessions across servers**. (Play-again-in-a-room was *not* selected — it already
lives in KANBAN nice-to-haves.) These are large, longer-horizon epics.

## Current state (why these stories exist)
- **Everything is in memory.** `GameManager` holds a `Map` of `GameRoom`s; each room
  holds a live `gameEngine` object and `gameState`. A restart/crash loses all rooms
  and games.
- **Identity is per-connection.** `playerId = socket.id` (`src/server/index.js:237`).
  A reconnect gets a new socket → a new id → you cannot rejoin your seat or attribute
  anything to "the same player" across a drop. **This blocks resume and stats.**
- **Stats evaporate.** `GameRoom` tracks `stats.gamesPlayed/gamesWon` on the in-memory
  player object; nothing is persisted.
- **Single machine by design.** `fly.toml` runs one always-on machine and says outright:
  rooms are in-memory so multiple instances "would not share state until we add the
  Redis adapter." No Redis dependency yet.

## Prerequisites from other epics
- **E1 persistence foundation** (DB layer) — hard dependency for S1/S2.
- **E4 user accounts** — needed to attach durable stats/history to a person (S2), and
  to make identity survive across devices (S0/S1). S0 provides a device-scoped identity
  that upgrades to an account when E4 lands.

## Dependency spine
```
S0 stable identity ──┬─► S1 persistent/resumable sessions ──► S3 concurrent (shared-state model)
   (needs E1)        └─► S2 history & stats (needs E1 + E4)
S3 also needs: Redis infra + S1 serialized state
```
Legend: `S`≈1–2 days · `M`≈3–5 days · `L`≈1–2 weeks · `XL`≈multi-week.

---

## Epic S0 — Stable player identity  *(prerequisite; needs E1)*

### [S0.1] Durable player token that outlives a socket  — `M`
**Value:** the same human is recognizable across reconnects, restarts, and (later) devices.
- [ ] Issue a signed, persistent **player token** (httpOnly cookie / localStorage) on first
      visit; independent of `socket.id`.
- [ ] `players`/`identities` table: id, token_hash, display_name, created_at,
      user_id? (nullable, linked when E4 accounts arrive).
- [ ] Rooms key players by **stable id**, not `socket.id`; `socket.playerId` resolves the
      token → stable id at join.
- [ ] Backward compatible: a guest with no token still gets an ephemeral id (no regression
      for drop-in play).
- [ ] Reissue/rotate rules; token is not a security credential until bound to an account (E4).
**Open Q:** cookie vs localStorage vs both; token lifetime.

---

## Epic S1 — Persistent & resumable sessions  *(needs E1 + S0)*

### [S1.1] Session entity + snapshot schema  — `M`
- [ ] `sessions`: id, room_code, game_type, status (`active|paused|ended|abandoned`),
      created_at, ended_at?, snapshot_version (int), pack_ids?, options JSON.
- [ ] `session_snapshots` (or a `snapshot` JSON column on `sessions`): serialized engine
      state + a monotonically increasing version for optimistic concurrency.
- [ ] Index by room_code + status (find the active session for a room fast).

### [S1.2] Engine serialize/restore contract  — `M`
> **Specified & recommended to land early** in `docs/madlad-card-platform-e1-e2-spec.md` §6
> (task E2.3b): the hooks are cheapest to add during the E2 engine object-refactor. If not
> folded there, this is S1's first task. The DB/persistence wiring below stays here in S1.
**Value:** any engine can be turned into plain data and rebuilt — cleanly, via the contract.
- [ ] Extend the game engine contract (`BaseGame`) with **optional** hooks:
      `serialize()` → plain JSON, and `static restore(room, snapshot, options)` → engine.
- [ ] Default behavior: engines without the hooks are marked non-resumable (session still
      records history but can't rehydrate) — keep it opt-in so the contract stays additive.
- [ ] Implement for `MadLadGame` (draw/discard/black piles, seat order, scores, phase — all
      already plain data) and `TestGame`.
- [ ] Compliance test: serialize → restore → deep-equal of public state (round-trip).
- [ ] Reuses the `validateEngine`/compliance harness from the contract work (C6).

### [S1.3] Snapshot persistence (write-through)  — `M`
- [ ] After each state-changing action (debounced/coalesced), persist the engine snapshot
      + bump version. Never in the socket hot path if it adds latency — write async.
- [ ] Backpressure/failure handling: a failed write logs + retries; gameplay never blocks.
- [ ] Mark `ended` on game over; `paused` when a room goes idle instead of destroying it.

### [S1.4] Resume / rehydrate  — `L`
**Value:** a game survives a restart or an idle gap and can be picked back up.
- [ ] On boot, do **not** eagerly load all sessions; rehydrate a room lazily when someone
      re-accesses it (by room code) and an `active|paused` session exists.
- [ ] Rebuild `GameRoom` + engine via `static restore()`; re-attach reconnecting players
      to their seats by stable id (S0).
- [ ] Sweep policy: `paused` sessions expire after a configurable TTL → `abandoned`.
- [ ] Room-code collision handling when reviving a code that was reassigned.
**Open Q:** how long a paused game is resumable (hours? days?); who can resume it.

### [S1.5] Reconnect handling within a live game  — `M`
- [ ] A player who drops and returns (same stable id) re-occupies their seat, hand intact,
      instead of joining as a new player. (Fixes today's `socket.id`-as-identity gap.)
- [ ] Grace window before a dropped player is treated as "left" for engine purposes
      (judge bail, turn skips) — configurable.
- [ ] Spectator (TV/host) reconnect re-syncs public state.
- Related nice-to-have already logged: "Reconnect handling if a phone drops mid-round."

---

## Epic S2 — Session history & stats  *(needs E1 + E4; S0 for pre-account attribution)*

### [S2.1] Completed-session records  — `M`
- [ ] On game end, persist a durable result: `sessions.status='ended'`, winner, duration,
      pack_ids, final scoreboard.
- [ ] `session_players`: session_id, player_id (stable id), user_id?, display_name,
      score, placement, won (bool).
- [ ] Backfill from the room's in-memory result at end-of-game (replaces the stats that
      currently evaporate in `GameRoom.endGame`).

### [S2.2] Durable per-account stats  — `M`
- [ ] Aggregate `gamesPlayed/gamesWon` (and more: win rate, favorite packs, streaks) onto
      the account (E4) / stable identity (pre-account).
- [ ] Migrate the in-memory `player.stats` bump in `GameRoom.endGame` to write through to
      `session_players` and roll up to the account.
- [ ] Guest→account merge: when a guest signs up (E4), attach their prior sessions.

### [S2.3] History UI  — `M`
- [ ] "Your past games" list (result, date, players, packs).
- [ ] Per-room series history (all sessions played under a room/group).

### [S2.4] Leaderboards  — `M` *(later)*
- [ ] Global / friends leaderboards; per-pack leaderboards.
- [ ] Anti-abuse: only count sessions above a min player count / duration.

---

## Epic S3 — Concurrent sessions across servers  *(needs E1 + S1; Redis infra)*  — `XL`

Removes the single-machine constraint called out in `fly.toml`. Large; sequence carefully.

### [S3.1] Socket.IO Redis adapter + cross-instance fan-out  — `M`
- [ ] Add Redis (Fly Upstash/Redis) + `@socket.io/redis-adapter` so room/spectator emits
      fan out across instances.
- [ ] Config-gated: single-instance dev runs without Redis; prod enables it.
- [ ] Health/metrics for adapter connectivity.

### [S3.2] Room ownership / routing model  — `L` *(key architectural decision)*
Two viable models — **decide before building S3.3/S3.4:**
- **(a) Sticky ownership:** each room is owned by exactly one instance (consistent hashing
  or session affinity); the live engine stays a single in-memory object; Redis adapter only
  delivers cross-instance socket traffic. *Simpler; limited by one room = one instance.*
- **(b) Shared authoritative state:** engine state lives in Redis/PG; any instance processes
  an action under a per-room lock (leveraging S1 serialization). *More robust/scalable; much
  more complex — locking, contention, snapshot on every action.*
- [ ] Choose (a) or (b) with a short ADR; recommend **(a) sticky** first, evolve to (b) only
      if a single room must outscale one machine (it rarely does — a party game room is small).

### [S3.3] Shared session/room registry  — `M`
- [ ] Any instance can locate the owner (model a) or authoritative state (model b) for a
      room by code — registry in Redis (fast) backed by `sessions` (durable).
- [ ] Room-create/route logic uses the registry; capacity limits become cluster-wide.

### [S3.4] Scaling & capacity config  — `M`
- [ ] `fly.toml`: allow >1 machine, `min_machines_running`, `auto_start/stop`, region(s).
- [ ] Graceful drain: on instance shutdown, `paused`-persist owned rooms (S1) so they can be
      revived elsewhere (model a) or simply hand off (model b).
- [ ] Per-instance + cluster capacity metrics.

### [S3.5] Load & soak testing  — `M`
- [ ] Multi-instance load test: N rooms × M players across ≥2 instances; verify fan-out,
      failover (kill an instance → rooms revive), and no cross-room leakage.
- [ ] Establish capacity numbers per machine size to inform pricing/margins.

---

## Cross-cutting notes
- **S0 is the linchpin.** Resume (S1.5), seat re-attach, and stat attribution (S2) all need a
  stable id. Build S0 before S1/S2 gameplay work.
- **Serialization is reused twice:** S1.2's `serialize()/restore()` enables both resume (S1.4)
  and the shared-state scale model (S3.2b). Design it once, cleanly, on the contract.
- **Keep the engine pure & synchronous.** Persistence (S1.3) and distribution (S3) live in the
  room/service/infra layers, never inside the engine — same principle as the deck injection
  in the E2 spec.
- **Recommended sequencing:** E1 → S0 → S1 (resume) → S2 (history/stats, after E4) → S3 (scale,
  once there's real concurrent demand). Don't build S3 before load justifies it.
- **Cost:** Redis + multi-machine (S3) is real recurring spend; gate it behind actual concurrency
  needs and the capacity numbers from S3.5.
```
