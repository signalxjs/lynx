import { mkdirSync, mkdtempSync, readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rootOptionalPeerImports } from '../lib/optional-peers.mjs';

const packagesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages');

function fixture(files) {
    const dir = mkdtempSync(join(tmpdir(), 'optional-peers-'));
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), content);
    }
    return dir;
}

const pkg = {
    exports: { '.': { import: './dist/index.js' }, './nav': { import: './dist/nav.js' } },
    peerDependencies: { opt: '*', req: '*' },
    peerDependenciesMeta: { opt: { optional: true } },
};

describe('rootOptionalPeerImports', () => {
    it('finds an optional peer reached through a re-export chain', () => {
        const dir = fixture({
            'src/index.ts': "export { A } from './a.js';\n",
            'src/a.tsx': "import { useNav } from 'opt/hooks';\nexport const A = 1;\n",
        });
        expect(rootOptionalPeerImports(dir, pkg)).toEqual([{ peer: 'opt', specifier: 'opt/hooks', file: 'src/a.tsx' }]);
    });

    it('ignores subpath entries, type-only imports and required peers', () => {
        const dir = fixture({
            'src/index.ts': "import type { T } from 'opt';\nexport type { U } from 'opt';\nimport 'req';\nexport const x = 1;\n",
            'src/nav.ts': "export * from 'opt';\n",
        });
        expect(rootOptionalPeerImports(dir, pkg)).toEqual([]);
    });

    it('skips an all-`type` brace list but not a mixed one', () => {
        const dir = fixture({
            'src/index.ts': "import { type T, type U as V } from 'opt';\nexport { type W } from 'opt/sub';\nexport { mixed } from './m.js';\n",
            'src/m.ts': "import { type T, useIt } from 'opt';\nexport const mixed = useIt;\n",
        });
        expect(rootOptionalPeerImports(dir, pkg)).toEqual([{ peer: 'opt', specifier: 'opt', file: 'src/m.ts' }]);
    });
});

// #1136: an app that installs only the package (as every README says) must be
// able to bundle its root entry. Peer-dependent code goes on a subpath.
describe('workspace packages', () => {
    const packages = readdirSync(packagesDir)
        .map((name) => join(packagesDir, name))
        .filter((dir) => existsSync(join(dir, 'package.json')));

    it.each(packages.map((dir) => [dir.split(/[\\/]/).pop(), dir]))(
        '%s: root entry imports no optional peer',
        (_name, dir) => {
            const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
            expect(rootOptionalPeerImports(dir, manifest)).toEqual([]);
        },
    );
});
