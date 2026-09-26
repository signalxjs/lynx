/**
 * optional-peers.mjs — find optional peers a package's ROOT entry reaches.
 *
 * An optional peer (`peerDependenciesMeta[name].optional`) may be absent from
 * the consuming app, and a bundler resolves every static import it walks. So a
 * root entry that statically reaches an optional peer breaks every app that
 * followed the README and installed only the package (#1136 —
 * `@sigx/lynx-daisyui` re-exported its navigation/markdown/emoji skins from the
 * root barrel). Peer-dependent code belongs on a subpath the app opts into
 * (`@sigx/lynx-heroui/navigation`, `@sigx/lynx-daisyui/markdown`, …); a peer
 * the root genuinely needs is not optional.
 *
 * The walk follows static `import` / `export … from` of relative modules from
 * the source file behind the `"."` export. Type-only imports are erased and
 * skipped: `import type` / `export type`, and a brace list whose every
 * specifier is `type`-qualified (`import { type A } from …` — elided because
 * the repo does not set `verbatimModuleSyntax`). Dynamic `import()` is a
 * runtime choice and skipped.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:([^'"]*?)\sfrom\s+)?['"]([^'"]+)['"]/gm;

/** `{ type A, type B as C }` — every specifier type-only, so TS erases the statement. */
function allTypeSpecifiers(clause) {
    const braces = clause?.trim().match(/^\{([\s\S]*)\}$/);
    if (!braces) return false;
    const specifiers = braces[1].split(',').map((s) => s.trim()).filter(Boolean);
    return specifiers.length > 0 && specifiers.every((s) => /^type\s/.test(s));
}

const SOURCE_EXTS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

/** `./dist/foo.js` → the `src/foo.ts(x)` behind it, or null. */
function sourceFor(pkgDir, distPath) {
    const base = join(pkgDir, distPath.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, ''));
    return SOURCE_EXTS.map((e) => base + e).find(existsSync) ?? null;
}

function rootExport(pkg) {
    const root = typeof pkg.exports === 'string' ? pkg.exports : pkg.exports?.['.'];
    if (typeof root === 'string') return root;
    return root?.import ?? root?.default ?? pkg.main ?? null;
}

/**
 * @param {string} pkgDir
 * @param {Record<string, any>} pkg parsed package.json
 * @returns {Array<{ peer: string, specifier: string, file: string }>}
 */
export function rootOptionalPeerImports(pkgDir, pkg) {
    const optional = Object.entries(pkg.peerDependenciesMeta ?? {})
        .filter(([, meta]) => meta?.optional)
        .map(([name]) => name);
    const entry = rootExport(pkg);
    if (!optional.length || !entry?.endsWith('.js')) return [];
    const start = sourceFor(pkgDir, entry);
    if (!start) return [];

    const hits = [];
    const seen = new Set();
    const stack = [start];
    while (stack.length) {
        const file = stack.pop();
        if (seen.has(file)) continue;
        seen.add(file);
        for (const [, clause, specifier] of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
            if (allTypeSpecifiers(clause)) continue;
            if (specifier.startsWith('.')) {
                const base = resolve(dirname(file), specifier.replace(/\.js$/, ''));
                const next = SOURCE_EXTS.map((e) => base + e).find(existsSync);
                if (next) stack.push(next);
                continue;
            }
            const peer = optional.find((o) => specifier === o || specifier.startsWith(`${o}/`));
            if (peer) hits.push({ peer, specifier, file: relative(pkgDir, file).split('\\').join('/') });
        }
    }
    return hits;
}
