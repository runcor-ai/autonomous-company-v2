// V2 lint runner — invoked by `npm run lint`. Runs both Principle-V lint guards and exits
// non-zero if either reports hits.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanForDirectProviderImports, reportHits as reportProvider } from './no-direct-provider.js';
import { scanForLawsLiteral, reportHits as reportLaws } from './no-laws-literal.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');

const providerHits = scanForDirectProviderImports(repoRoot);
const lawsHits = scanForLawsLiteral(repoRoot);

reportProvider(providerHits);
reportLaws(lawsHits);

if (providerHits.length > 0 || lawsHits.length > 0) {
  process.exit(1);
}
