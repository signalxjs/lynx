/**
 * Integration test for {@link applyIcons}: drives the full scan → adapter
 * lookup → virtual-module emit pipeline against a temp project on disk.
 *
 * Uses a stub adapter package (not the real fa-free) so the test stays
 * hermetic and the FA peerDep isn't pulled into lynx-plugin's test runtime.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyIcons } from '../src/icons';

// ---------------------------------------------------------------------------
// A fake Rsbuild API that records resolve.alias.set() calls.
// ---------------------------------------------------------------------------

interface AliasRecorder {
    aliases: Record<string, string>;
}

function makeFakeApi(recorder: AliasRecorder): Parameters<typeof applyIcons>[0] {
    return {
        modifyBundlerChain(fn: (chain: unknown) => void) {
            const chain = {
                resolve: {
                    alias: {
                        set: (key: string, value: string) => {
                            recorder.aliases[key] = value;
                            return chain.resolve.alias;
                        },
                    },
                },
            };
            fn(chain);
        },
        // Other methods aren't exercised; cast through unknown.
    } as unknown as Parameters<typeof applyIcons>[0];
}

// ---------------------------------------------------------------------------
// Temp project setup
// ---------------------------------------------------------------------------

let projectRoot: string;

function writeFile(rel: string, content: string): void {
    const full = join(projectRoot, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
}

function setupFakeAdapter(): void {
    // Mimic a real adapter package layout so loadAdapter() can resolve it
    // via cwd's require. Provide a default export with getGlyph/getFontPath.
    const adapterDir = join(projectRoot, 'node_modules', 'fake-icons-adapter');
    mkdirSync(adapterDir, { recursive: true });
    writeFileSync(
        join(adapterDir, 'package.json'),
        JSON.stringify({ name: 'fake-icons-adapter', main: './index.mjs', type: 'module' }),
        'utf8',
    );
    writeFileSync(
        join(adapterDir, 'index.mjs'),
        `
const adapter = {
  styles: ['solid'],
  getGlyph(style, name) {
    if (style !== 'solid') return null;
    const map = {
      'user': { codepoint: 0xf007, svg: '<svg viewBox="0 0 16 16" fill="__COLOR__"><path d="M0 0"/></svg>' },
      'house': { codepoint: 0xf015, svg: '<svg viewBox="0 0 16 16" fill="__COLOR__"><path d="M1 1"/></svg>' },
      'search': { svg: '<svg viewBox="0 0 16 16" fill="none" stroke="__COLOR__"><path d="M2 2"/></svg>' },
    };
    return map[name] ?? null;
  },
  getFontPath() { return null; },
};
export default adapter;
`,
        'utf8',
    );
}

beforeEach(() => {
    // applyIcons does `import('@sigx/lynx-cli')` to load + resolve config; the
    // ambient workspace resolution finds it from the lynx-plugin package, so
    // no project-local link is needed. Test configs are plain .mjs so they
    // don't depend on the temp project's node_modules.
    projectRoot = mkdtempSync(join(tmpdir(), 'sigx-icons-test-'));
    setupFakeAdapter();
});

afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('applyIcons', () => {
    it('is a no-op when sigx.lynx.config.ts is missing', async () => {
        const recorder: AliasRecorder = { aliases: {} };
        await applyIcons(makeFakeApi(recorder), { cwd: projectRoot });
        expect(recorder.aliases).toEqual({});
    });

    it('is a no-op when iconSets is empty', async () => {
        writeFile(
            'sigx.lynx.config.mjs',
            `export default { name: 'T', iconSets: [] };`,
        );
        const recorder: AliasRecorder = { aliases: {} };
        await applyIcons(makeFakeApi(recorder), { cwd: projectRoot });
        expect(recorder.aliases).toEqual({});
    });

    it('scans source, resolves used glyphs, writes virtual modules, aliases imports', async () => {
        writeFile(
            'sigx.lynx.config.mjs',
            `export default {
                name: 'IconTest',
                iconSets: [{ id: 'fake', source: 'fake-icons-adapter' }],
            };`,
        );
        writeFile(
            'src/screen.tsx',
            `import { Icon } from '@sigx/lynx-icons';
            export const Hello = () => (
                <view>
                    <Icon set="fake" name="user" size={20} />
                    <Icon set="fake" name="house" />
                    <Icon set="fake" name="search" />
                </view>
            );`,
        );
        writeFile(
            'src/other.tsx',
            `// glyph used only here:\nconst x = <Icon set="fake" name="user" />;`,
        );

        const recorder: AliasRecorder = { aliases: {} };
        await applyIcons(makeFakeApi(recorder), { cwd: projectRoot });

        // Aliases registered for all three subpaths
        expect(Object.keys(recorder.aliases).sort()).toEqual([
            '@sigx/lynx-icons/__codepoints',
            '@sigx/lynx-icons/__font-face.css',
            '@sigx/lynx-icons/__svgs',
        ]);

        // Generated files exist
        const codepointsPath = recorder.aliases['@sigx/lynx-icons/__codepoints'];
        const svgsPath = recorder.aliases['@sigx/lynx-icons/__svgs'];
        const fontFacePath = recorder.aliases['@sigx/lynx-icons/__font-face.css'];
        expect(existsSync(codepointsPath)).toBe(true);
        expect(existsSync(svgsPath)).toBe(true);
        expect(existsSync(fontFacePath)).toBe(true);

        // codepoints includes user/house (which have codepoints) but NOT search (svg-only)
        const codepointsContent = readFileSync(codepointsPath, 'utf8');
        expect(codepointsContent).toContain('"fake":');
        expect(codepointsContent).toContain('"user":61447'); // 0xf007
        expect(codepointsContent).toContain('"house":61461'); // 0xf015
        expect(codepointsContent).not.toContain('"search":');

        // svgs includes all three used glyphs
        const svgsContent = readFileSync(svgsPath, 'utf8');
        expect(svgsContent).toContain('"user":');
        expect(svgsContent).toContain('"house":');
        expect(svgsContent).toContain('"search":');
        expect(svgsContent).toContain('__COLOR__');
    });

    it('respects iconSet.include for dynamic-name glyphs', async () => {
        writeFile(
            'sigx.lynx.config.mjs',
            `export default {
                name: 'IncludeTest',
                iconSets: [{ id: 'fake', source: 'fake-icons-adapter', include: ['house'] }],
            };`,
        );
        // No <Icon> in source — only the include[] should cause emission.
        writeFile('src/empty.tsx', `export const X = () => <view />;`);

        const recorder: AliasRecorder = { aliases: {} };
        await applyIcons(makeFakeApi(recorder), { cwd: projectRoot });

        const svgsContent = readFileSync(recorder.aliases['@sigx/lynx-icons/__svgs'], 'utf8');
        expect(svgsContent).toContain('"house":');
        expect(svgsContent).not.toContain('"user":');
    });

    it('silently skips an iconSet whose adapter cannot be resolved', async () => {
        writeFile(
            'sigx.lynx.config.mjs',
            `export default {
                name: 'MissingAdapter',
                iconSets: [{ id: 'fake', source: 'fake-icons-adapter' }, { id: 'gone', source: 'package-does-not-exist' }],
            };`,
        );
        writeFile('src/screen.tsx', `const x = <Icon set="fake" name="user" />; const y = <Icon set="gone" name="user" />;`);

        const recorder: AliasRecorder = { aliases: {} };
        await applyIcons(makeFakeApi(recorder), { cwd: projectRoot });

        // Aliases still registered (other set succeeded)
        expect(Object.keys(recorder.aliases).length).toBe(3);

        const svgsContent = readFileSync(recorder.aliases['@sigx/lynx-icons/__svgs'], 'utf8');
        expect(svgsContent).toContain('"fake":');
        expect(svgsContent).not.toContain('"gone":');
    });
});
