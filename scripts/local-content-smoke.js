#!/usr/bin/env node
/* eslint-disable no-console */
// Exercise the real local HTTP service and leave two candidates for UI review.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const base = new URL(process.env.LOCAL_API_URL || 'http://localhost:3180');
assert(
  base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname),
  'LOCAL_API_URL must be loopback HTTP',
);
assert(!base.username && !base.password, 'Do not put credentials in LOCAL_API_URL');
const contentToken = process.env.LOCAL_CONTENT_TOKEN || 'local-content-only';
const adminToken = process.env.LOCAL_ADMIN_TOKEN || 'local-review-only';
const contentHeaders = { Authorization: `Bearer ${contentToken}` };
const adminHeaders = { 'X-Admin-Token': adminToken };
const route = '/api/content/cards';

async function request(path, expected, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, expected, `${method} ${path}: expected ${expected}, got ${response.status}`);
  const text = await response.text();
  return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
}

async function main() {
  await request('/healthz', 200);
  await request(route, 401);
  await request(route, 401, { headers: { Authorization: 'Bearer invalid-local-token' } });
  await request('/admin/content', 404);
  const tag = `Local smoke ${randomUUID()}`;
  const texts = [
    'The babysitter asked for hazard pay after discovering ____.',
    'A raccoon with administrator privileges.',
    'A disposable test candidate.',
    'My emergency contact is now ____.',
    'A group chat subpoena.',
  ];
  const cards = texts.map((text) => ({
    text: `${text} (${tag})`,
    kind: text.includes('____') ? 'prompt' : 'answer',
    blanks: text.includes('____') ? 1 : 0,
    maturity_rating: 2,
    pack: 'madlad-generated',
  }));
  const submit = (batch) => request(route, 201, {
    method: 'POST', headers: contentHeaders, body: { cards: batch },
  });
  const batch = await submit(cards);
  assert.deepEqual(batch.rejected, []);
  assert.equal(batch.created.length, 5);
  const [approved, denied, deleted, ...pending] = batch.created;
  const initial = await request(`${route}?limit=100`, 200, { headers: contentHeaders });
  batch.created.forEach((id) => assert.equal(initial.cards.find((card) => card.id === id)?.status, 'pending'));
  await request(`${route}/${approved}`, 404, {
    method: 'PATCH', headers: contentHeaders, body: { status: 'approved' },
  });
  await request(`${route}/${approved}`, 200, {
    method: 'PATCH', headers: adminHeaders, body: { status: 'approved' },
  });
  await request(`${route}/${denied}`, 200, {
    method: 'PATCH',
    headers: adminHeaders,
    body: { status: 'denied', denied_reason: 'Local smoke test' },
  });
  const duplicate = await submit([cards[1]]);
  assert.equal(duplicate.skipped, 1);
  assert.deepEqual(duplicate.created, []);
  await request(`${route}/${deleted}`, 200, { method: 'DELETE', headers: contentHeaders });
  await request(`${route}/${approved}`, 409, { method: 'DELETE', headers: contentHeaders });
  const final = await request(`${route}?limit=100`, 200, { headers: contentHeaders });
  assert.equal(final.cards.find((card) => card.id === approved)?.status, 'approved');
  assert.equal(final.cards.find((card) => card.id === denied)?.status, 'denied');
  assert(!final.cards.some((card) => card.id === deleted));
  const html = await request('/admin/content', 200, { headers: adminHeaders });
  pending.forEach((id) => {
    const card = final.cards.find((item) => item.id === id);
    assert.equal(card?.status, 'pending');
    assert(html.includes(card.text), 'Pending candidate missing from review page');
  });
  console.log('PASS: authorization, submission, approval, denial, dedupe, deletion, review page.');
  console.log(`Left pending card IDs ${pending.join(', ')} for browser testing.`);
  console.log(`Open ${new URL('/admin/content', base)} using the local admin token from deploy/local/README.md.`);
}

main().catch((error) => {
  console.error(`Local content smoke failed: ${error.message}`);
  process.exitCode = 1;
});
