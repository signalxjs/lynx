/**
 * Web `resolve.extensionAlias` merge (signalxjs/lynx#697).
 *
 * `resolve.extensions` only rewrites extensionless specifiers, so per-package
 * `.web.ts` shims — which compile to `dist/*.web.js` referenced from dists via
 * explicit `./x.js` imports — need `.web.js` prepended to the extensionAlias
 * list on the web environment. The merge must preserve rsbuild's
 * tsconfig-driven mapping and stay idempotent. (End-to-end proof lived in the
 * #697 probe: a `haptics.web.ts` marker reached the showcase web bundle and
 * stayed out of the native bundle.)
 */
import { describe, it, expect } from 'vitest';

import { prependWebExtensionAlias } from '../src/entry';

describe('prependWebExtensionAlias', () => {
  it("merges ahead of rsbuild's tsconfig-driven mapping", () => {
    expect(prependWebExtensionAlias(['.js', '.ts', '.tsx'], '.js', '.web.js')).toEqual([
      '.web.js',
      '.js',
      '.ts',
      '.tsx',
    ]);
  });

  it('falls back to the identity alias when no mapping exists', () => {
    expect(prependWebExtensionAlias(undefined, '.js', '.web.js')).toEqual(['.web.js', '.js']);
  });

  it('normalizes a bare-string mapping', () => {
    expect(prependWebExtensionAlias('.ts', '.js', '.web.js')).toEqual(['.web.js', '.ts']);
  });

  it('is idempotent when the web extension is already present', () => {
    expect(
      prependWebExtensionAlias(['.web.js', '.js', '.ts', '.tsx'], '.js', '.web.js'),
    ).toEqual(['.web.js', '.js', '.ts', '.tsx']);
  });
});
