#!/usr/bin/env node
// Cross-platform recursive delete. Equivalent to `rm -rf <path>...` but
// works on Windows CI. Use from package.json scripts: `node ../../scripts/clean.mjs dist`.
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const targets = process.argv.slice(2);
if (targets.length === 0) {
    console.error('Usage: clean.mjs <path> [<path>...]');
    process.exit(2);
}
for (const t of targets) {
    rmSync(resolve(t), { recursive: true, force: true });
}
