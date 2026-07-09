## 1.15.0 (2026-07-09)

* fix(test): update remaining hand-size assertions to 8 (#43) ([57f9577](https://github.com/jrrall/ace-cast/commit/57f9577)), closes [#43](https://github.com/jrrall/ace-cast/issues/43) [#42](https://github.com/jrrall/ace-cast/issues/42)
* feat(madlad): deal 8-card hands (was 7) (#42) ([7927257](https://github.com/jrrall/ace-cast/commit/7927257)), closes [#42](https://github.com/jrrall/ace-cast/issues/42)

## 1.14.0 (2026-07-09)

* feat(healthz): report the deployed version from package.json (#41) ([56cbd0e](https://github.com/jrrall/ace-cast/commit/56cbd0e)), closes [#41](https://github.com/jrrall/ace-cast/issues/41)

## 1.13.0 (2026-07-09)

* feat(lobby): auto-start countdown once enough players are seated (#40) ([b70c9cc](https://github.com/jrrall/ace-cast/commit/b70c9cc)), closes [#40](https://github.com/jrrall/ace-cast/issues/40)

## <small>1.12.7 (2026-07-09)</small>

* fix(cards): taller uniform hand cards (168px, 6-line clamp) (#39) ([383ec01](https://github.com/jrrall/ace-cast/commit/383ec01)), closes [#39](https://github.com/jrrall/ace-cast/issues/39)

## <small>1.12.6 (2026-07-09)</small>

* fix(cards): uniform hand/judge card size in the shared grid (#38) ([d3882fd](https://github.com/jrrall/ace-cast/commit/d3882fd)), closes [#38](https://github.com/jrrall/ace-cast/issues/38)

## <small>1.12.5 (2026-07-09)</small>

* revert(j2): flat tap-to-play hand instead of the fanned lift+confirm (#37) ([4073d7a](https://github.com/jrrall/ace-cast/commit/4073d7a)), closes [#37](https://github.com/jrrall/ace-cast/issues/37)

## <small>1.12.4 (2026-07-09)</small>

* fix(deploy): Authelia default_policy one_factor (fixes /account 403) (#36) ([909f44c](https://github.com/jrrall/ace-cast/commit/909f44c)), closes [#36](https://github.com/jrrall/ace-cast/issues/36)

## <small>1.12.3 (2026-07-09)</small>

* fix(deploy): define Authelia session.cookies in config (env list unsupported) (#35) ([76bfe03](https://github.com/jrrall/ace-cast/commit/76bfe03)), closes [#35](https://github.com/jrrall/ace-cast/issues/35)

## <small>1.12.2 (2026-07-09)</small>

* fix(deploy): make Authelia portal reachable under /authelia (#34) ([9d1c3aa](https://github.com/jrrall/ace-cast/commit/9d1c3aa)), closes [#34](https://github.com/jrrall/ace-cast/issues/34)

## <small>1.12.1 (2026-07-09)</small>

* fix(deploy): bootstrap generates E4 Authelia secrets + admin user (#32) ([f3df494](https://github.com/jrrall/ace-cast/commit/f3df494)), closes [#32](https://github.com/jrrall/ace-cast/issues/32)
* fix(deploy): bootstrap generates E4 Authelia secrets + admin user (#33) ([ae71449](https://github.com/jrrall/ace-cast/commit/ae71449)), closes [#33](https://github.com/jrrall/ace-cast/issues/33) [#32](https://github.com/jrrall/ace-cast/issues/32)

## 1.12.0 (2026-07-09)

* feat(e4): user accounts behind a pluggable auth provider + Authelia forward-auth (#26) ([cb08695](https://github.com/jrrall/ace-cast/commit/cb08695)), closes [#26](https://github.com/jrrall/ace-cast/issues/26)
* feat(j6): synthesized sound + haptics for card play, flip, and win (#31) ([50f1d7b](https://github.com/jrrall/ace-cast/commit/50f1d7b)), closes [#31](https://github.com/jrrall/ace-cast/issues/31)

## 1.11.0 (2026-07-09)

* feat(f3): feedback dashboard + card retirement (F4) (#28) ([72a3e79](https://github.com/jrrall/ace-cast/commit/72a3e79)), closes [#28](https://github.com/jrrall/ace-cast/issues/28)
* feat(j2): fanned hand with tap-to-lift + confirm-to-play on phone (#29) ([81a6e9d](https://github.com/jrrall/ace-cast/commit/81a6e9d)), closes [#29](https://github.com/jrrall/ace-cast/issues/29)
* feat(j5): TV board choreography — deal-in, paced reveal, judge spotlight, animated scoreboard (#30) ([84cfb49](https://github.com/jrrall/ace-cast/commit/84cfb49)), closes [#30](https://github.com/jrrall/ace-cast/issues/30)
* feat(s1): persistent & resumable room sessions (#27) ([4159ccb](https://github.com/jrrall/ace-cast/commit/4159ccb)), closes [#27](https://github.com/jrrall/ace-cast/issues/27)

## <small>1.10.2 (2026-07-09)</small>

* docs(kanban): reconcile board — stack merged to main via #25 ([4affcc6](https://github.com/jrrall/ace-cast/commit/4affcc6)), closes [#25](https://github.com/jrrall/ace-cast/issues/25) [#19](https://github.com/jrrall/ace-cast/issues/19) [#20](https://github.com/jrrall/ace-cast/issues/20) [#21](https://github.com/jrrall/ace-cast/issues/21) [#24](https://github.com/jrrall/ace-cast/issues/24) [#25](https://github.com/jrrall/ace-cast/issues/25) [#19](https://github.com/jrrall/ace-cast/issues/19)
* Content/topical cards (#25) ([445d4ee](https://github.com/jrrall/ace-cast/commit/445d4ee)), closes [#25](https://github.com/jrrall/ace-cast/issues/25)

## <small>1.10.1 (2026-07-08)</small>

* fix: remove stray red line on cards; add game-over countdown + session release (#24) ([a0e89a9](https://github.com/jrrall/ace-cast/commit/a0e89a9)), closes [#24](https://github.com/jrrall/ace-cast/issues/24)
* Chore/rebrand unholy (#23) ([b93afa4](https://github.com/jrrall/ace-cast/commit/b93afa4)), closes [#23](https://github.com/jrrall/ace-cast/issues/23)
* chore: rebrand user-facing strings to unholy.cards (#22) ([5389676](https://github.com/jrrall/ace-cast/commit/5389676)), closes [#22](https://github.com/jrrall/ace-cast/issues/22)

## 1.10.0 (2026-07-08)

* feat: bots — fill a small table so 2 humans play like a full room (#21) ([6377961](https://github.com/jrrall/ace-cast/commit/6377961)), closes [#21](https://github.com/jrrall/ace-cast/issues/21)

## 1.9.0 (2026-07-08)

* feat(ui): Unholy Ritual theme, TV cast fixes, card rescind (#20) ([60a998c](https://github.com/jrrall/ace-cast/commit/60a998c)), closes [#20](https://github.com/jrrall/ace-cast/issues/20)

## 1.8.0 (2026-07-08)

* feat: S0 device identity + F2 card flagging (reconciled onto J1 renderer) (#19) ([6911021](https://github.com/jrrall/ace-cast/commit/6911021)), closes [#19](https://github.com/jrrall/ace-cast/issues/19) [#14](https://github.com/jrrall/ace-cast/issues/14) [#17](https://github.com/jrrall/ace-cast/issues/17)
* chore(deploy): prep DB-backed deploy on Fly Postgres (F0) (#15) ([b710b7e](https://github.com/jrrall/ace-cast/commit/b710b7e)), closes [#15](https://github.com/jrrall/ace-cast/issues/15)

## 1.7.0 (2026-07-08)

* Deploy/linode sqlite (#18) ([db2d755](https://github.com/jrrall/ace-cast/commit/db2d755)), closes [#18](https://github.com/jrrall/ace-cast/issues/18)
* feat(j1): shared card design system + renderer for TV and phone clients (#14) ([829a8b5](https://github.com/jrrall/ace-cast/commit/829a8b5)), closes [#14](https://github.com/jrrall/ace-cast/issues/14)
* docs(kanban): reconcile board with shipped work (#13) ([7f72eb7](https://github.com/jrrall/ace-cast/commit/7f72eb7)), closes [#13](https://github.com/jrrall/ace-cast/issues/13)

## 1.6.0 (2026-07-07)

* feat: reconnect grace window and per-play humor metrics (#17) ([1bc7ce8](https://github.com/jrrall/ace-cast/commit/1bc7ce8)), closes [#17](https://github.com/jrrall/ace-cast/issues/17)

## <small>1.5.1 (2026-07-07)</small>

* docs: revise F5/F6 as iterable "table's sense of humor" card-gen loop (#16) ([fbd6dfc](https://github.com/jrrall/ace-cast/commit/fbd6dfc)), closes [#16](https://github.com/jrrall/ace-cast/issues/16)

## 1.5.0 (2026-07-07)

* Merge F1: card outcome telemetry ([2f49624](https://github.com/jrrall/ace-cast/commit/2f49624))
* feat: card outcome telemetry (F1) ([d5799e5](https://github.com/jrrall/ace-cast/commit/d5799e5))

## <small>1.4.1 (2026-07-07)</small>

* docs: groom Playtest Feedback Loop epic (F0–F6) (#12) ([0202ecd](https://github.com/jrrall/ace-cast/commit/0202ecd)), closes [#12](https://github.com/jrrall/ace-cast/issues/12)
* Feat/e2.3 deck service (#11) ([43249a2](https://github.com/jrrall/ace-cast/commit/43249a2)), closes [#11](https://github.com/jrrall/ace-cast/issues/11)

## 1.4.0 (2026-07-07)

* feat(db): seed madlad-core default pack from madladCards.js (E2.2) (#10) ([a4384e4](https://github.com/jrrall/ace-cast/commit/a4384e4)), closes [#10](https://github.com/jrrall/ace-cast/issues/10)

## <small>1.3.1 (2026-07-07)</small>

* docs: groom Card & Hand Game-Feel ("Juice") epic (J1–J7) (#7) ([72b7a58](https://github.com/jrrall/ace-cast/commit/72b7a58)), closes [#7](https://github.com/jrrall/ace-cast/issues/7)
* docs(cards): add AGENTS.md authoring guide for src/game/data (#9) ([d987442](https://github.com/jrrall/ace-cast/commit/d987442)), closes [#9](https://github.com/jrrall/ace-cast/issues/9) [#5](https://github.com/jrrall/ace-cast/issues/5)
* Feat/e1 db foundation (#8) ([6c1959c](https://github.com/jrrall/ace-cast/commit/6c1959c)), closes [#8](https://github.com/jrrall/ace-cast/issues/8)

## 1.3.0 (2026-07-07)

* feat(cards): give the MadLad deck more bite (#5) ([41d3674](https://github.com/jrrall/ace-cast/commit/41d3674)), closes [#5](https://github.com/jrrall/ace-cast/issues/5)
* Docs/madlad card platform backlog (#6) ([f4ce1d0](https://github.com/jrrall/ace-cast/commit/f4ce1d0)), closes [#6](https://github.com/jrrall/ace-cast/issues/6)

## 1.2.0 (2026-07-06)

* Merge pull request #4 from jrrall/chore/game-registry-and-madlad ([c8c3cf6](https://github.com/jrrall/ace-cast/commit/c8c3cf6)), closes [#4](https://github.com/jrrall/ace-cast/issues/4)
* feat(game): formalize the game engine contract with BaseGame + validation ([db178b5](https://github.com/jrrall/ace-cast/commit/db178b5))

## <small>1.1.1 (2026-07-06)</small>

* Merge pull request #3 from jrrall/chore/game-registry-and-madlad ([ac78301](https://github.com/jrrall/ace-cast/commit/ac78301)), closes [#3](https://github.com/jrrall/ace-cast/issues/3)
* refactor: rename CAH game to MadLad and add a game registry ([b2330b0](https://github.com/jrrall/ace-cast/commit/b2330b0))
* chore: target Node 22 only, trim CI matrix, harden socket e2e test ([4d77a85](https://github.com/jrrall/ace-cast/commit/4d77a85))

## 1.1.0 (2026-07-06)

* Merge pull request #2 from jrrall/feat/cah-prototype-and-cloud-foundation ([9397659](https://github.com/jrrall/ace-cast/commit/9397659)), closes [#2](https://github.com/jrrall/ace-cast/issues/2)
* feat: add kanban board and refactor files ([68557f1](https://github.com/jrrall/ace-cast/commit/68557f1))
* feat: add kanban board with feature backlog ([25c123d](https://github.com/jrrall/ace-cast/commit/25c123d))
* feat: enable poker and CAH games in host UI - QR code player join working ([05a0402](https://github.com/jrrall/ace-cast/commit/05a0402))
* feat: implement complete CAHGame engine with judge rotation and voting ([184851e](https://github.com/jrrall/ace-cast/commit/184851e))
* feat: implement complete PokerGame engine with betting rounds and hand evaluation ([a905845](https://github.com/jrrall/ace-cast/commit/a905845))
* feat: implement real player statistics - gamesPlayed and gamesWon now increment on game end ([80353cc](https://github.com/jrrall/ace-cast/commit/80353cc))
* feat: playable CAH prototype and cloud-deployable backend ([5e025a2](https://github.com/jrrall/ace-cast/commit/5e025a2))
* docs: update kanban board with completed core features - games, stats, and QR code ready ([97c88b0](https://github.com/jrrall/ace-cast/commit/97c88b0))
* docs: update kanban board with completed poker feature ([12a5a66](https://github.com/jrrall/ace-cast/commit/12a5a66))
* refactor: wire up BaseGameEngine - PokerGame and CAHGame now extend it properly ([3ade809](https://github.com/jrrall/ace-cast/commit/3ade809))

## 1.0.0 (2025-09-27)

* fix: fixes tests temporarily ([7a26b56](https://github.com/jrrall/ace-cast/commit/7a26b56))
* fix: resolve semantic-release GitHub permissions issue ([ac72925](https://github.com/jrrall/ace-cast/commit/ac72925))
* Merge pull request #1 from jrrall/feat/add-ci ([89e477f](https://github.com/jrrall/ace-cast/commit/89e477f)), closes [#1](https://github.com/jrrall/ace-cast/issues/1)
* feat: add comprehensive CI/CD pipeline with GitHub Actions ([eb08002](https://github.com/jrrall/ace-cast/commit/eb08002))
* feat: adds readme.md ([7cb612b](https://github.com/jrrall/ace-cast/commit/7cb612b))
* feat: initial commit ([60644ec](https://github.com/jrrall/ace-cast/commit/60644ec))
