#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Operator CLI for content-API service tokens (F2, Card Forge).
 *
 *   npm run token:create -- --client card-forge-prod [--name "..."] [--scopes content:read,content:write]
 *   npm run token:list
 *   npm run token:revoke -- --client card-forge-prod
 *
 * The plaintext token is printed exactly once, by `create`. Only its SHA-256 is
 * stored, so a lost token is re-minted, never recovered.
 */
const ServiceTokenRepository = require('../src/content/ServiceTokenRepository');
const { close } = require('../src/db');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

async function cmdCreate(args) {
  const clientId = args.client || args.clientId;
  if (!clientId) {
    console.error('error: --client <id> is required (e.g. --client card-forge-prod)');
    return 1;
  }
  const { token, row } = await ServiceTokenRepository.create({
    clientId,
    name: typeof args.name === 'string' ? args.name : clientId,
    scopes: typeof args.scopes === 'string' ? args.scopes : undefined,
    createdBy: 'cli',
  });
  console.log('');
  console.log('  ┌─ Service token created — SAVE THIS, it is shown only once ─────');
  console.log(`  │  client_id : ${row.client_id}`);
  console.log(`  │  scopes    : ${row.scopes}`);
  console.log(`  │  token     : ${token}`);
  console.log('  └────────────────────────────────────────────────────────────────');
  console.log('');
  console.log('  Use it as:  Authorization: Bearer <token>');
  console.log('  Card Forge: set CONTENT_API_TOKEN=<token> in card-forge/.env');
  console.log('');
  return 0;
}

async function cmdList() {
  const rows = await ServiceTokenRepository.list();
  if (rows.length === 0) {
    console.log('No service tokens. The content API is OFF unless CONTENT_API_TOKEN is set.');
    return 0;
  }
  rows.forEach((r) => {
    const state = r.revoked_at ? `REVOKED ${r.revoked_at}` : 'active';
    const used = r.last_used_at || 'never';
    console.log(`${r.client_id}\t${state}\tscopes=${r.scopes.join(',')}\tlast_used=${used}`);
  });
  return 0;
}

async function cmdRevoke(args) {
  const clientId = args.client || args.clientId;
  if (!clientId) {
    console.error('error: --client <id> is required');
    return 1;
  }
  const revoked = await ServiceTokenRepository.revoke(clientId);
  console.log(revoked
    ? `Revoked service token for '${clientId}'.`
    : `No active token found for '${clientId}'.`);
  return revoked ? 0 : 1;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  let code;
  switch (command) {
    case 'create': code = await cmdCreate(args); break;
    case 'list': code = await cmdList(); break;
    case 'revoke': code = await cmdRevoke(args); break;
    default:
      console.error('usage: service-token.js <create|list|revoke> [--client <id>] [--name <n>] [--scopes <a,b>]');
      code = 1;
  }
  await close();
  return code;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
