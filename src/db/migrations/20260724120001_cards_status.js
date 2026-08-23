/**
 * F1 (Card Forge) — card review lifecycle.
 *
 * Cards gain a `pending → approved/denied` lifecycle so LLM-generated content
 * can be quarantined until a human approves it. Mirrors the additive/reversible
 * shape of `cards_retired_at.js`.
 *
 * The column default is **`pending` (fail-closed)**: a row with no explicit
 * status is invisible to gameplay until reviewed. Because of that default, the
 * `up` backfill below is **load-bearing** — every pre-existing (human-curated)
 * row must be flipped to `approved`, or the new `status='approved'` deck filter
 * (CardRepository.listForDeck) would empty every deck and DeckService.buildDeck
 * would throw "Deck is empty" for the whole live game.
 *
 * `down` drops all five columns. On SQLite that rebuilds the `cards` table
 * (create-copy-drop-rename). Knex guards the rebuild with `PRAGMA foreign_keys
 * = OFF`, but that pragma is a **no-op inside a transaction** — so if this
 * migration ran in knex's default per-migration transaction, dropping the old
 * `cards` table would fire ON DELETE CASCADE and wipe every FK child
 * (`card_stats`, `card_flags`, `card_humor_tags`, `card_events`). Running it
 * WITHOUT a transaction (config below) lets knex's guard take effect, so the
 * children survive the rebuild (verified by cards_status_migration.test.js).
 */

// No wrapping transaction: required for the SQLite table-rebuild FK guard in
// `down` to work (see header). Add-column + backfill in `up` is simple enough
// that the lost atomicity is acceptable.
exports.config = { transaction: false };

exports.up = async (knex) => {
  await knex.schema.alterTable('cards', (t) => {
    t.enu('status', ['pending', 'approved', 'denied']).notNullable()
      .defaultTo('pending'); // fail-closed: unreviewed content never reaches a deck
    t.enu('source', ['manual', 'generated']).notNullable()
      .defaultTo('manual');
    t.timestamp('reviewed_at').nullable();
    t.string('reviewed_by').nullable();
    t.text('denied_reason').nullable();
    // Deck hot path now also filters on status; keep it indexed.
    t.index(['game_id', 'pack_id', 'status'], 'idx_cards_deck_status');
  });

  // Load-bearing backfill: existing rows are human-curated and live — approve
  // them so the new status filter doesn't empty every deck on deploy.
  await knex('cards').update({ status: 'approved', source: 'manual' });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('cards', (t) => {
    t.dropIndex(['game_id', 'pack_id', 'status'], 'idx_cards_deck_status');
    t.dropColumn('status');
    t.dropColumn('source');
    t.dropColumn('reviewed_at');
    t.dropColumn('reviewed_by');
    t.dropColumn('denied_reason');
  });
};
