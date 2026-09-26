import { appendFileSync } from 'node:fs';
import { command, resolveTag } from './lib.mjs';

const resolved = resolveTag(process.env.RELEASE_TAG, process.env.EXPECTED_SHA);
const release = JSON.parse(command('gh', ['release', 'view', resolved.tag,
  '--repo', process.env.GITHUB_REPOSITORY, '--json', 'tagName,isDraft,isPrerelease']));
if (release.tagName !== resolved.tag || release.isDraft !== false || release.isPrerelease !== false) {
  throw new Error('Only published stable GitHub releases may be built');
}
const outputs = { ...resolved, image: `ghcr.io/${process.env.GITHUB_REPOSITORY.toLowerCase()}/card-forge` };
appendFileSync(process.env.GITHUB_OUTPUT,
  Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''));
