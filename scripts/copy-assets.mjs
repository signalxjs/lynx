#!/usr/bin/env node
// Recursively copy a directory of static assets (e.g. CSS) into a build output.
// Usage: node scripts/copy-assets.mjs <src> <dest>
import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const [src, dest] = process.argv.slice(2);
if (!src || !dest) {
    console.error('Usage: copy-assets.mjs <src> <dest>');
    process.exit(2);
}
const srcAbs = resolve(src);
const destAbs = resolve(dest);
await mkdir(dirname(destAbs), { recursive: true });
await cp(srcAbs, destAbs, { recursive: true });
console.log(`copy-assets: ${src} → ${dest}`);
