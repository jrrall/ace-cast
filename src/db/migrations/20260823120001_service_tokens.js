/**
 * F2 (Card Forge) — service/client tokens for machine callers.
 *
 * Replaces the single shared `CONTENT_API_TOKEN` secret with named, revocable
 * per-client credentials. The shared secret had no way to answer "which agent
 * submitted this batch?", no way to revoke one client without breaking every
 * other, and no rotation story short of redeploying both sides at once.
 *
 * Only the SHA-256 of a token is stored. Tokens are 32 bytes of CSPRNG output,
 * so unlike passwords they carry full entropy and need no slow KDF — and the
 * lookup is an indexed equality match on the hash, which leaks no timing
 * information about the secret.
 *
 * `revoked_at` is a soft delete on purpose: a revoked row keeps its client_id
 * so an audit of past submissions can still resolve who sent what.
 *
 * Because of that retention, `client_id` is unique only among LIVE rows — a
 * plain unique constraint would make rotation impossible, since rotating means
 * revoking `card-forge-prod` and immediately minting `card-forge-prod` again.
 * A partial unique index gives both: one active credential per client, and an
 * unlimited history of revoked ones. SQLite and Postgres both support it.
 */

exports.up = async (knex) => {
  await knex.schema.createTable('service_tokens', (t) => {
    t.increments('id').primary();
    // Stable, human-meaningful identity for the caller, e.g. 'card-forge-prod'.
    // Uniqueness is enforced by the partial index below, NOT here.
    t.string('client_id').notNullable();
    t.string('name').notNullable();
    // SHA-256 hex of the presented token. Unique so a lookup is a single
    // indexed probe rather than a scan-and-compare.
    t.string('token_hash', 64).notNullable()
      .unique();
    // Comma-separated grants. The default is what a Card Forge agent needs:
    // read the corpus to dedupe against, then submit. Narrow it per client.
    t.string('scopes').notNullable()
      .defaultTo('content:read,content:write');
    t.timestamp('created_at').notNullable()
      .defaultTo(knex.fn.now());
    t.string('created_by').nullable();
    // Observability: lets an operator spot a credential that stopped being used
    // (agent broken) or one still live that should have been retired.
    t.timestamp('last_used_at').nullable();
    // Soft delete — see header.
    t.timestamp('revoked_at').nullable();
    t.index(['token_hash'], 'idx_service_tokens_hash');
  });

  // One LIVE credential per client, unlimited revoked history. Knex's schema
  // builder has no partial-index form, so this is raw — the syntax below is
  // accepted by both SQLite and Postgres.
  await knex.schema.raw(
    'CREATE UNIQUE INDEX idx_service_tokens_client_active '
    + 'ON service_tokens (client_id) WHERE revoked_at IS NULL',
  );
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('service_tokens');
};
