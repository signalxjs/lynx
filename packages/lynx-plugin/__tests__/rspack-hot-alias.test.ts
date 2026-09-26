/**
 * `resolveRspackHotDir` (#1147): the HMR client is requested as
 * `@rspack/core/hot/dev-server` from the app, which doesn't depend on
 * `@rspack/core` — under pnpm's isolated layout only rspeedy's own copy
 * exists. The resolver finds it through rspeedy → rsbuild → rspack.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRspackHotDir } from '../src/entry.js';

const showcase = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/showcase');

describe('resolveRspackHotDir', () => {
    it('finds @rspack/core/hot through rspeedy for an app that does not depend on @rspack/core', () => {
        const hot = resolveRspackHotDir(showcase);
        expect(hot).not.toBeNull();
        expect(existsSync(path.join(hot!, 'dev-server.js'))).toBe(true);
        expect(existsSync(path.join(hot!, 'emitter.js'))).toBe(true);
    });
});
