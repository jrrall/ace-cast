import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command, parseTag, resolveTag, releaseOutputs, inspectManifest, publishManifest } from './lib.mjs';

const sha = 'a'.repeat(40);
const image = 'ghcr.io/example/repo/card-forge';
const candidate = {
  schemaVersion: 2,
  mediaType: 'application/vnd.oci.image.index.v1+json',
  annotations: { 'org.opencontainers.image.revision': sha, 'org.opencontainers.image.version': '1.22.1' },
  manifests: ['amd64', 'arm64'].map((architecture, index) => ({
    digest: `sha256:${String(index).repeat(64)}`, platform: { os: 'linux', architecture },
  })),
};

function registry(initial = {}, manifest = candidate) {
  const state = structuredClone(initial);
  const writes = [];
  const run = (program, args) => {
    assert.equal(program, 'docker');
    if (args[2] === 'inspect') {
      const ref = args.at(-1);
      if (state[ref]) return JSON.stringify(state[ref]);
      throw Object.assign(new Error('missing'), { stderr: `ERROR: ${ref}: not found` });
    }
    assert.equal(args[2], 'create');
    if (args.includes('--dry-run')) return JSON.stringify(manifest);
    const ref = args[args.indexOf('--tag') + 1];
    writes.push(ref);
    state[ref] = structuredClone(manifest);
    return '';
  };
  return { run, writes, state };
}
const options = { image, sha, version: '1.22.1', sources: ['arch-amd64', 'arch-arm64'] };

test('only canonical stable version tags are accepted', () => {
  assert.equal(parseTag('v1.22.1'), '1.22.1');
  assert.equal(parseTag('v0.0.0'), '0.0.0');
  for (const value of ['1.22.1', 'main', 'v01.2.3', 'v1.2', 'v1.2.3-rc.1', 'v1.2.3\n', 'v1.2.3;echo bad']) {
    assert.throws(() => parseTag(value));
  }
});

test('no-release runs produce no image inputs', async () => {
  const outputs = await releaseOutputs(async () => false, () => assert.fail('must not resolve a tag'));
  assert.deepEqual(outputs, { published: 'false' });
});

test('release failures propagate without publication outputs', async () => {
  await assert.rejects(releaseOutputs(async () => { throw new Error('release failed'); }), /release failed/);
});

test('tag resolution uses the actual release commit, including annotated historical tags', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-release-'));
  const git = (args) => command('git', args, { cwd: dir });
  const run = (program, args) => command(program, args, { cwd: dir });
  try {
    git(['init', '-q']);
    git(['config', 'user.name', 'Test']);
    git(['config', 'user.email', 'test@example.com']);
    git(['commit', '--allow-empty', '-qm', 'trigger']);
    const trigger = git(['rev-parse', 'HEAD']);
    git(['commit', '--allow-empty', '-qm', 'release']);
    const released = git(['rev-parse', 'HEAD']);
    git(['tag', '-a', 'v1.22.1', '-m', 'release']);
    git(['commit', '--allow-empty', '-qm', 'later main']);
    assert.deepEqual(resolveTag('v1.22.1', '', run), { tag: 'v1.22.1', version: '1.22.1', sha: released });
    assert.throws(() => resolveTag('v1.22.1', trigger, run), /expected commit/);
    const result = await releaseOutputs(async () => ({ nextRelease: {
      gitTag: 'v1.22.1', version: '1.22.1', gitHead: released,
    } }), run);
    assert.equal(result.sha, released);
    assert.equal(result.published, 'true');
    // Run the manual entry point against the historical tag using a fake read-only GitHub CLI.
    const gh = join(dir, 'gh');
    writeFileSync(gh, '#!/bin/sh\nprintf \'%s\' "$RELEASE_JSON"\n', { mode: 0o755 });
    const output = join(dir, 'output');
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, RELEASE_TAG: 'v1.22.1',
      EXPECTED_SHA: '', GITHUB_REPOSITORY: 'Example/Repo', GITHUB_OUTPUT: output,
      RELEASE_JSON: JSON.stringify({ tagName: 'v1.22.1', isDraft: false, isPrerelease: false }) };
    command(process.execPath, [new URL('./resolve.mjs', import.meta.url).pathname], { cwd: dir, env });
    assert.match(readFileSync(output, 'utf8'), new RegExp(`sha=${released}\\n`));
    assert.match(readFileSync(output, 'utf8'), /image=ghcr.io\/example\/repo\/card-forge/);
    for (const badRelease of [
      { tagName: 'v1.22.1', isDraft: true },
      { tagName: 'v1.22.1', isPrerelease: true },
      { tagName: 'v1.22.2' },
    ]) {
      assert.throws(() => command(process.execPath, [new URL('./resolve.mjs', import.meta.url).pathname],
        { cwd: dir, env: { ...env, RELEASE_JSON: JSON.stringify(badRelease) }, stdio: 'pipe' }));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing release manifests publish both explicit version and full SHA', () => {
  const fake = registry();
  publishManifest(options, fake.run);
  assert.deepEqual(fake.writes, [`${image}:1.22.1`, `${image}:${sha}`]);
  assert.deepEqual(fake.state[`${image}:1.22.1`], candidate);
});

test('identical manifests are idempotent and never rewritten', () => {
  const fake = registry({ [`${image}:1.22.1`]: candidate, [`${image}:${sha}`]: candidate });
  publishManifest(options, fake.run);
  assert.deepEqual(fake.writes, []);
});

test('partial publication can finish without rewriting an existing version', () => {
  const fake = registry({ [`${image}:1.22.1`]: candidate });
  publishManifest(options, fake.run);
  assert.deepEqual(fake.writes, [`${image}:${sha}`]);
});

test('any differing image blocks all publication, even with the same revision label', () => {
  const different = structuredClone(candidate);
  different.manifests[0].digest = `sha256:${'b'.repeat(64)}`;
  for (const ref of [`${image}:1.22.1`, `${image}:${sha}`]) {
    const fake = registry({ [ref]: different });
    assert.throws(() => publishManifest(options, fake.run), /Refusing to overwrite/);
    assert.deepEqual(fake.writes, []);
  }
});

test('registry failures and malformed responses fail closed', () => {
  for (const stderr of ['unauthorized: access denied', 'connection reset', 'TLS timeout', 'denied: manifest unknown']) {
    assert.throws(() => inspectManifest(image, () => { throw Object.assign(new Error(stderr), { stderr }); }));
  }
  assert.throws(() => inspectManifest(image, () => 'not json'));
});

test('missing architecture or wrong source revision prevents publication', () => {
  const missing = structuredClone(candidate);
  missing.manifests.pop();
  const wrong = structuredClone(candidate);
  wrong.annotations['org.opencontainers.image.revision'] = 'b'.repeat(40);
  for (const manifest of [missing, wrong]) {
    const fake = registry({}, manifest);
    assert.throws(() => publishManifest(options, fake.run), /exact revision/);
    assert.deepEqual(fake.writes, []);
  }
});
