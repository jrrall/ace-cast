/**
 * F4 — card retirement.
 *
 * Retirement is a soft flag, not a delete: `retired_at` is a nullable
 * timestamp, set when an admin retires a card and cleared to un-retire it
 * (explicit, reversible — see FeedbackRepository / CardRepository). A retired
 * card is simply excluded from `DeckService.buildDeck` (`retired_at IS NULL`);
 * its history in `card_stats` / `card_events` / `card_flags` is untouched.
 */

exports.up = async (knex) => {
  await knex.schema.alterTable('cards', (t) => {
    t.timestamp('retired_at').nullable();
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('cards', (t) => {
    t.dropColumn('retired_at');
  });
};
