#!/usr/bin/env node
// Snapshot-template dist emitter (#644): compile a package's `src/` to
// `dist/` with JSX lowered to main-thread snapshot templates, so CONSUMING
// apps get templated subtrees from this package even though library dists
// bypass the app-build snapshot pass (the loaders deliberately never rewrite
// node_modules/dist files — cross-layer module identity).
//
// Emitted shape, per .tsx file:
//
//   <JS-target transform output>       ← module code: _jsx(__snapshot_*, …)
//                                        calls, null-body registrations,
//                                        worklet {_wkltId} placeholders
//   <appended LEPUS-target snapshotCreatorMap assignments>
//                                        ← REAL create()/update[] bodies
//
// Both bundle layers evaluate the whole file (library passthrough), and the
// real-body assignments run after the null-body ones, overwriting the lazy
// creator before anything can materialize (getSnapshotDef only caches on
// first USE, which is at render time, after module eval). On the BG the real
// bodies are dead weight that is never invoked — the jsx wrapper only needs
// the ids registered.
//
// Invariants this script enforces:
//   - The transform is resolved THROUGH @sigx/lynx-plugin's dependency graph,
//     so the exact-pinned version the app loaders use also stamps the dist
//     (uniqIDs are content-hash-derived per (filename, source); a version
//     skew here would be caught only at runtime).
//   - `filename` passed to both transform runs is the machine-independent
//     `<pkg-name>/src/<rel>` — identical across the JS/LEPUS runs (id
//     equality) and across checkouts (reproducible dists).
//   - Transform options mirror packages/lynx-plugin/src/loaders/
//     snapshot-config.ts + worklet-loader.ts for the library case
//     (defineDCE off — thread defines are app-src-only; dynamicImport off —
//     sigx owns async chunks, #599/#612). Keep them in sync BY HAND; this
//     script cannot import the plugin's TS.
//
// Usage (from a package dir, after clean):
//   node ../../scripts/build-snapshot-dist.mjs
// then `tsgo --emitDeclarationOnly` for the .d.ts surface.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

// Resolve the transform through lynx-plugin's dependency graph (filesystem
// path — its exports map hides package.json from module resolution) so the
// dist is stamped by the exact same (pinned) transform version the app
// loaders run.
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const pluginRequire = createRequire(
    resolve(scriptsDir, '../packages/lynx-plugin/package.json'),
);
const { transformReactLynxSync } = pluginRequire('@lynx-js/react/transform');

const pkgRoot = process.cwd();
const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
const srcDir = join(pkgRoot, 'src');
const distDir = join(pkgRoot, 'dist');

// --- kept in sync with packages/lynx-plugin/src/loaders/snapshot-config.ts ---
const SNAPSHOT_RUNTIME_PKG = '@sigx/lynx/internal';
const SNAPSHOT_UNSUPPORTED_RE = /\buse:[A-Za-z_$][\w$]*\s*=/;
const SNAPSHOT_INJECT = { inject: { globDynamicComponentEntry: ['expr', "'__sigx__'"] } };
// -----------------------------------------------------------------------------

function transformOnce(source, filename, target, withSnapshot) {
    return transformReactLynxSync(source, {
        pluginName: 'sigx:snapshot-dist',
        filename,
        sourcemap: false,
        cssScope: false,
        shake: false,
        compat: false,
        refresh: false,
        defineDCE: false,
        directiveDCE: false,
        dynamicImport: false,
        snapshot: withSnapshot
            ? {
                preserveJsx: false,
                runtimePkg: SNAPSHOT_RUNTIME_PKG,
                jsxImportSource: '@sigx/lynx',
                filename,
                target,
            }
            : false,
        ...(withSnapshot ? { inject: SNAPSHOT_INJECT } : {}),
        worklet: { target, filename, runtimePkg: '@sigx/lynx' },
    });
}

// ---------------------------------------------------------------------------
// Statement slicing — the same shapes the app loaders extract. Build-time
// twin of packages/lynx-runtime/src/hmr-extract.ts's scanner (string /
// template-literal / regex / comment aware); duplicated because repo scripts
// can't import package TS. Operates only on our own transform output.
// ---------------------------------------------------------------------------

function regexCanStartAt(source, idx) {
    let j = idx - 1;
    while (j >= 0 && /\s/.test(source[j])) j--;
    if (j < 0) return true;
    if ('(,=:[!&|?{;+-*%<>^~'.includes(source[j])) return true;
    const tail = /([A-Za-z_$][\w$]*)$/.exec(source.slice(Math.max(0, j - 11), j + 1));
    return tail !== null
        && /^(?:return|typeof|case|in|of|new|delete|void|do|else|await|throw|yield)$/.test(tail[1]);
}

function scanBalanced(source, openIdx) {
    const open = source[openIdx];
    const close = open === '(' ? ')' : open === '[' ? ']' : '}';
    let depth = 0;
    for (let i = openIdx; i < source.length; i++) {
        const ch = source[i];
        if (ch === "'" || ch === '"') {
            i++;
            while (i < source.length && source[i] !== ch) {
                if (source[i] === '\\') i++;
                i++;
            }
            continue;
        }
        if (ch === '`') {
            i++;
            const tplStack = [0];
            while (i < source.length && tplStack.length > 0) {
                const t = source[i];
                if (t === '\\') i++;
                else if (t === '$' && source[i + 1] === '{') { tplStack[tplStack.length - 1]++; i++; }
                else if (t === '{' && tplStack[tplStack.length - 1] > 0) tplStack[tplStack.length - 1]++;
                else if (t === '}' && tplStack[tplStack.length - 1] > 0) tplStack[tplStack.length - 1]--;
                else if (t === '`') {
                    if (tplStack[tplStack.length - 1] > 0) tplStack.push(0);
                    else tplStack.pop();
                }
                i++;
            }
            i--;
            continue;
        }
        if (ch === '/' && source[i + 1] === '/') {
            while (i < source.length && source[i] !== '\n') i++;
            continue;
        }
        if (ch === '/' && source[i + 1] === '*') {
            i += 2;
            while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
            i++;
            continue;
        }
        if (ch === '/' && regexCanStartAt(source, i)) {
            i++;
            let inClass = false;
            while (i < source.length && (inClass || source[i] !== '/')) {
                if (source[i] === '\\') i++;
                else if (source[i] === '[') inClass = true;
                else if (source[i] === ']') inClass = false;
                else if (source[i] === '\n') break;
                i++;
            }
            continue;
        }
        if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function detectSnapshotNamespace(code) {
    const m = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']@sigx\/lynx\/internal["']/.exec(code);
    return m ? m[1] : null;
}

/**
 * Strip comments (string/template-aware) before slicing — SWC preserves
 * JSDoc, and comment text mentioning the marker tokens would desync
 * indexOf-based slicing. Mirror of the loaders' stripper.
 */
function stripJsComments(code) {
    let out = '';
    let i = 0;
    const n = code.length;
    while (i < n) {
        const c = code[i];
        const next = code[i + 1];
        if (c === '/' && next === '/') {
            while (i < n && code[i] !== '\n') i++;
            out += ' ';
            continue;
        }
        if (c === '/' && next === '*') {
            i += 2;
            while (i < n && !(code[i] === '*' && code[i + 1] === '/')) {
                if (code[i] === '\n') out += '\n';
                i++;
            }
            i += 2;
            out += ' ';
            continue;
        }
        if (c === "'" || c === '"') {
            out += c;
            i++;
            while (i < n && code[i] !== c) {
                if (code[i] === '\\') { out += code[i]; i++; }
                if (i < n) { out += code[i]; i++; }
            }
            if (i < n) { out += code[i]; i++; }
            continue;
        }
        if (c === '`') {
            out += c;
            i++;
            let depth = 0;
            while (i < n) {
                if (code[i] === '\\') { out += code[i] + (code[i + 1] ?? ''); i += 2; continue; }
                if (code[i] === '$' && code[i + 1] === '{') { depth++; out += '${'; i += 2; continue; }
                if (code[i] === '{' && depth > 0) { depth++; out += '{'; i++; continue; }
                if (code[i] === '}' && depth > 0) { depth--; out += '}'; i++; continue; }
                if (code[i] === '`' && depth === 0) break;
                out += code[i];
                i++;
            }
            if (i < n) { out += code[i]; i++; }
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

/** Slice `<ns>.snapshotCreatorMap[…] = …createSnapshot(…);` assignments. */
function sliceCreatorAssignments(rawCode, ns) {
    const code = stripJsComments(rawCode);
    const out = [];
    const marker = `${ns}.snapshotCreatorMap[`;
    let from = 0;
    while (true) {
        const idx = code.indexOf(marker, from);
        if (idx === -1) break;
        const calleeAt = code.indexOf('createSnapshot', idx);
        if (calleeAt === -1) break;
        const callOpen = code.indexOf('(', calleeAt);
        if (callOpen === -1) break;
        const callClose = scanBalanced(code, callOpen);
        if (callClose === -1) break;
        let end = callClose + 1;
        if (end < code.length && code[end] === ';') end++;
        out.push(code.slice(idx, end));
        from = end;
    }
    return out;
}

// ---------------------------------------------------------------------------

function walk(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === '__tests__') continue;
            walk(p, out);
        } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
            out.push(p);
        }
    }
    return out;
}

let templated = 0;
let fellBack = 0;

for (const abs of walk(srcDir)) {
    const rel = relative(srcDir, abs);
    const relPosix = rel.split(sep).join('/');
    // Machine-independent, identical for both runs → stable, matching ids.
    const filename = `${pkg.name}/src/${relPosix}`;
    const source = readFileSync(abs, 'utf8');

    const wantSnapshot = /\.tsx$/.test(abs) && !SNAPSHOT_UNSUPPORTED_RE.test(source);
    let code;
    if (!wantSnapshot) {
        code = transformOnce(source, filename, 'JS', false).code;
    } else {
        let js;
        try {
            js = transformOnce(source, filename, 'JS', true);
        } catch (e) {
            // Same safety net as the loaders: a WASM panic degrades this file
            // to the per-element path.
            console.warn(`[snapshot-dist] ${relPosix}: snapshot pass failed, per-element fallback (${String(e).slice(0, 80)})`);
            fellBack++;
            js = transformOnce(source, filename, 'JS', false);
        }
        code = js.code;
        const jsNs = detectSnapshotNamespace(code);
        if (jsNs) {
            const lepus = transformOnce(source, filename, 'LEPUS', true);
            const lepusNs = detectSnapshotNamespace(lepus.code);
            if (lepusNs !== jsNs) {
                throw new Error(`[snapshot-dist] ${relPosix}: namespace local diverged between targets (${jsNs} vs ${lepusNs})`);
            }
            const assignments = sliceCreatorAssignments(lepus.code, lepusNs);
            // Completeness invariant: every template the LEPUS output
            // registers must be sliced. A partial slice would silently ship
            // a dist whose null-body registrations lack their real-body
            // overwrites — MT materialization would throw at render time,
            // far from the cause. Fail the BUILD instead.
            const lepusIds = new Set(stripJsComments(lepus.code).match(/snapshotCreatorMap\[(?:__snapshot_[A-Za-z0-9_]+)\]/g) ?? []);
            if (assignments.length !== lepusIds.size) {
                throw new Error(
                    `[snapshot-dist] ${relPosix}: sliced ${assignments.length} registrations `
                    + `but the LEPUS output registers ${lepusIds.size} — scanner edge case; refusing to emit`,
                );
            }
            // `model` two-way binding on an intrinsic element cannot work
            // inside a template: the element never passes through the
            // jsx-runtime, so the platform model processor that expands it
            // to value + bindinput never runs — the directive would ship to
            // the main thread as a dead `model` attribute (and the input
            // would never write back, see #650). Detectable right here in
            // the compiled create/update bodies; fail the BUILD with the
            // authoring fix instead of shipping a silently broken binding.
            if (/__SetAttribute\(\s*[A-Za-z_$][\w$]*\s*,\s*["']model["']/.test(stripJsComments(lepus.code))) {
                throw new Error(
                    `[snapshot-dist] ${relPosix}: model={...} on an intrinsic element inside a `
                    + `snapshot template — the model processor cannot run there. Wire it as a `
                    + `controlled input instead: value={model.value} + bindinput.`,
                );
            }
            // Every assignment's template id must already be declared by the
            // JS module code (same source, same ids) — a miss means the
            // slicing or the id contract broke.
            for (const a of assignments) {
                const id = /snapshotCreatorMap\[(__snapshot_[A-Za-z0-9_]+)\]/.exec(a)?.[1];
                if (!id || !code.includes(`const ${id} = `)) {
                    throw new Error(`[snapshot-dist] ${relPosix}: appended registration for ${id} has no matching const in module code`);
                }
            }
            if (assignments.length > 0) {
                code += '\n// #644: real-body template registrations (LEPUS target). Evaluated on\n'
                    + '// both bundle layers after the null-body ones above — last write wins,\n'
                    + '// and nothing can have materialized at module-eval time.\n'
                    + assignments.join('\n') + '\n';
                templated++;
            }
        }
    }

    const outPath = join(distDir, rel.replace(/\.tsx?$/, '.js'));
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, code);
}

console.log(`[snapshot-dist] ${pkg.name}: emitted ${templated} templated file(s)${fellBack ? `, ${fellBack} fallback(s)` : ''}`);
