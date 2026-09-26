import { appendFileSync } from 'node:fs';
import semanticRelease from 'semantic-release';
import { releaseOutputs } from './lib.mjs';

const outputs = await releaseOutputs(semanticRelease);
appendFileSync(process.env.GITHUB_OUTPUT,
  Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''));
