#!/usr/bin/env node
// Registers the TypeScript loader so the CLI can share the app's source modules.
import { register } from 'tsx/esm/api';

register();
const { main } = await import('./sdv.ts');
process.exitCode = await main(process.argv.slice(2));
