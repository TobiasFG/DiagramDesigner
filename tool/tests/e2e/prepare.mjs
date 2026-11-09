// Copies the fixture design into a scratch directory the e2e dev server writes to.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const work = fileURLToPath(new URL('./.work/design', import.meta.url));
const fixture = fileURLToPath(new URL('../../../design', import.meta.url));
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
cpSync(fixture, work, { recursive: true });
