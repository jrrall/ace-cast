import { publishManifest } from './lib.mjs';

const { IMAGE: image, COMMIT: sha, VERSION: version, BUILD_ID: buildId } = process.env;
if (!/^\d+$/.test(buildId)) throw new Error('Invalid build identity');
publishManifest({ image, sha, version,
  sources: ['amd64', 'arm64'].map((arch) => `${image}:build-${buildId}-${arch}`) });
