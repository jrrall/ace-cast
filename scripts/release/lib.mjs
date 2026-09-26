import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

export function command(program, args, options = {}) {
  return execFileSync(program, args, { encoding: 'utf8', stdio: 'pipe', ...options }).trim();
}

export function parseTag(tag) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
    throw new Error('Expected a stable release tag such as v1.22.1');
  }
  return tag.slice(1);
}

export function resolveTag(tag, expectedSha, run = command) {
  const version = parseTag(tag);
  const sha = run('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
  if (!/^[a-f0-9]{40}$/.test(sha) || (expectedSha && sha !== expectedSha)) {
    throw new Error(`Release tag ${tag} does not match the expected commit`);
  }
  return { tag, version, sha };
}

export async function releaseOutputs(release, run = command) {
  const result = await release();
  if (!result) return { published: 'false' };
  // @semantic-release/git creates a release commit after the triggering commit.
  const resolved = resolveTag(result.nextRelease.gitTag, result.nextRelease.gitHead, run);
  if (result.nextRelease.version !== resolved.version) throw new Error('Release version/tag mismatch');
  return { published: 'true', ...resolved };
}

export function inspectManifest(ref, run = command) {
  try {
    return JSON.parse(run('docker', ['buildx', 'imagetools', 'inspect', '--raw', ref]));
  } catch (error) {
    const stderr = String(error.stderr || '');
    // Only an explicit missing manifest is safe. Auth/network/parse failures abort.
    if (!/unauthorized|denied|forbidden/i.test(stderr)
        && (stderr.includes('manifest unknown') || stderr.includes(`${ref}: not found`))) return null;
    throw error;
  }
}

export function validateManifest(manifest, sha, version) {
  const platforms = manifest.manifests?.map(({ platform }) => `${platform?.os}/${platform?.architecture}`).sort();
  if (!isDeepStrictEqual(platforms, ['linux/amd64', 'linux/arm64'])
      || manifest.annotations?.['org.opencontainers.image.revision'] !== sha
      || manifest.annotations?.['org.opencontainers.image.version'] !== version) {
    throw new Error('Release manifest must contain AMD64 + ARM64 and exact revision/version annotations');
  }
}

export function publishManifest({ image, sha, version, sources }, run = command) {
  parseTag(`v${version}`);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid commit SHA');
  const create = ['buildx', 'imagetools', 'create',
    '--annotation', `index:org.opencontainers.image.revision=${sha}`,
    '--annotation', `index:org.opencontainers.image.version=${version}`];
  const candidate = JSON.parse(run('docker', [...create, '--dry-run', ...sources]));
  validateManifest(candidate, sha, version);
  const refs = [`${image}:${version}`, `${image}:${sha}`];
  // Check every destination before writing any: never partially publish a known conflict.
  const existing = refs.map((ref) => inspectManifest(ref, run));
  existing.forEach((manifest, index) => {
    if (manifest && !isDeepStrictEqual(manifest, candidate)) {
      throw new Error(`Refusing to overwrite existing image ${refs[index]}`);
    }
  });
  refs.forEach((ref, index) => {
    if (!existing[index]) run('docker', [...create, '--tag', ref, ...sources]);
    if (!isDeepStrictEqual(inspectManifest(ref, run), candidate)) {
      throw new Error(`Published manifest verification failed for ${ref}`);
    }
  });
}
