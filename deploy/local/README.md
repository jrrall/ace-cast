# Local Card Forge UI and API testing

From the repository root, start the real game application with a separate local
SQLite volume:

```bash
docker compose -f deploy/local/compose.yml up -d --build --wait app
```

- Game: <http://localhost:3180>
- Admin overview: <http://localhost:3180/admin?token=local-review-only>
- All cards: <http://localhost:3180/admin/cards?token=local-review-only>
- Review UI: <http://localhost:3180/admin/content?token=local-review-only>
- Gameplay feedback: <http://localhost:3180/admin/feedback?token=local-review-only>
- Content API: <http://localhost:3180/api/content/cards>
- Local machine token: `local-content-only`
- Local admin token: `local-review-only`

These fixed credentials are only for the loopback-bound local test stack.
This exercises the application's token gates. Production's additional Caddy /
Authelia browser login is not part of this stack. In the checked-in deployment,
Authelia authenticates the browser; `ADMIN_TOKEN` still gates the admin routes,
and content-service tokens (or legacy `CONTENT_API_TOKEN`) gate machine calls.
An Authelia session or identity header does not replace the content token.

## Test the API and populate the UI without an LLM

```bash
node scripts/local-content-smoke.js
```

The smoke test checks authorization, submits a small batch, tests approval,
denial, dedupe, and pending deletion, and leaves two new pending sample cards
for clicking through in the browser. It only accepts a loopback HTTP destination.
Run again to create a fresh batch. Use `LOCAL_PORT=3181` on Compose commands and
`LOCAL_API_URL=http://localhost:3181` on the smoke command to use another port.

## Run Card Forge against the local game

The forge service reads your optional `card-forge/.env.local` for LLM settings,
but overrides the content API URL and credentials to this local app. It also
uses the host LLM address and a 300-second timeout by default. Set
`LOCAL_LLM_BASE_URL` if the LLM lives on another machine. The model comes from
`LLM_MODEL` in `.env.local`, or the agent's default.

```bash
# Full real-news chain, corpus read from the local game, final batch to stdout.
docker compose -f deploy/local/compose.yml run --rm --build forge --dry-run
```

**For submission**, Compose's default dry-run command must be overridden:

```bash
docker run --rm --network ace-cast-local_default \
  -e CONTENT_API_URL=http://app:3000 \
  -e CONTENT_API_TOKEN=local-content-only \
  -e LLM_BASE_URL=http://host.docker.internal:11434/v1 \
  -e LLM_TIMEOUT=300 \
  -e LLM_REASONING_EFFORT=none \
  card-forge:dev
```

No `--dry-run` is passed, so the agent submits. This command targets the local
app on its Docker network. Approve or
deny the pending cards in the review UI. Check progress with:

```bash
docker compose -f deploy/local/compose.yml logs -f app
```

## Stop or reset

```bash
# Keep the local database for later testing.
docker compose -f deploy/local/compose.yml down

# Explicitly discard only this stack's local database and start fresh.
docker compose -f deploy/local/compose.yml down -v
```
