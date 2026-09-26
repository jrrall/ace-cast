const { db } = require('../db');

async function overview() {
  const rows = await db()('cards').select('status')
    .count({ count: '*' })
    .groupBy('status');
  const counts = { pending: 0, approved: 0, denied: 0 };
  rows.forEach((row) => { counts[row.status] = Number(row.count); });
  const retired = await db()('cards').whereNotNull('retired_at')
    .count({ count: '*' })
    .first();
  const writerRows = await db()('cards').where({ source: 'generated' })
    .select('writer', 'status')
    .count({ count: '*' })
    .groupBy('writer', 'status');
  const byWriter = new Map();
  writerRows.forEach((row) => {
    const writer = row.writer || 'unknown';
    if (!byWriter.has(writer)) {
      byWriter.set(writer, {
        writer, pending: 0, approved: 0, denied: 0,
      });
    }
    byWriter.get(writer)[row.status] = Number(row.count);
  });
  const writers = [...byWriter.values()].sort((a, b) => a.writer.localeCompare(b.writer));
  return {
    writers, ...counts, total: rows.reduce((sum, row) => sum + Number(row.count), 0), retired: Number(retired.count),
  };
}

async function library(query = {}) {
  const value = (key) => (typeof query[key] === 'string' ? query[key] : '');
  const allowed = (key, options) => (options.includes(value(key)) ? value(key) : '');
  const filters = {
    q: value('q').trim()
      .slice(0, 200),
    status: allowed('status', ['pending', 'approved', 'denied']),
    kind: allowed('kind', ['prompt', 'answer']),
    source: allowed('source', ['manual', 'generated']),
    retired: allowed('retired', ['yes', 'no']),
    pack: value('pack'),
    writer: value('writer').slice(0, 64),
  };
  const base = db()('cards as c').leftJoin('packs as p', 'p.id', 'c.pack_id');
  if (filters.q) {
    const escaped = filters.q.toLowerCase().replace(/[!%_]/g, '!$&');
    base.whereRaw('LOWER(c.text) LIKE ? ESCAPE \'!\'', [`%${escaped}%`]);
  }
  ['status', 'kind', 'source'].forEach((key) => { if (filters[key]) base.where(`c.${key}`, filters[key]); });
  if (filters.writer === 'unknown') base.whereNull('c.writer');
  else if (filters.writer) base.where('c.writer', filters.writer);
  if (filters.pack) base.where('p.slug', filters.pack);
  if (filters.retired === 'yes') base.whereNotNull('c.retired_at');
  if (filters.retired === 'no') base.whereNull('c.retired_at');
  const count = await base.clone().count({ count: 'c.id' })
    .first();
  const total = Number(count.count);
  const pageSize = 50;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const requested = Number(value('page'));
  const page = Math.min(pages, Number.isSafeInteger(requested) && requested > 0 ? requested : 1);
  const cards = await base.clone().select('c.*', 'p.name as packName')
    .orderBy('c.id', 'desc')
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const packs = await db()('packs').select('slug', 'name')
    .orderBy('name');
  const writerRows = await db()('cards').whereNotNull('writer')
    .distinct('writer')
    .orderBy('writer');
  return {
    writers: writerRows.map((row) => row.writer),
    cards,
    packs,
    filters,
    total,
    page,
    pages,
  };
}

module.exports = { overview, library };
