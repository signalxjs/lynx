/**
 * #1201 — workspace audit of what `'main thread'` worklets capture.
 *
 * A worklet reaches every module-level binding it names through its `_c`
 * capture, and `_c` crosses from BG to MT as JSON. That silently decides
 * what a worklet can call:
 *   - a `'main thread'` function crosses as a `{ _wkltId }` ref that the MT
 *     worklet runtime turns back into a callable — fine;
 *   - a plain function is dropped by `JSON.stringify`, so on MT the name is
 *     `undefined` and calling it throws `TypeError: not a function`.
 * That second case is exactly how every iOS edge-swipe back broke: the
 * gesture worklets captured `screenWidthMT`, a plain helper (#920 → #1201).
 * Nothing catches it off-device — lynx-testing has no MT runtime.
 *
 * The second hazard is a plain object a worklet mutates. The transform copies
 * the fields each worklet reads into ITS OWN `_c`, so one gesture handler's
 * writes never reach the next one (EdgeBackHandle's `startPageX` / velocity).
 * Cross-worklet state belongs in a `useMainThreadRef`.
 *
 * The third is calling a method on a captured object. The transform copies
 * just the members a worklet touches — `ARR.indexOf(x)` captures
 * `{ ARR: { indexOf: ARR.indexOf } }` — and the method is dropped on the wire,
 * so it throws `not a function` (device-verified on iOS, #1201).
 *
 * This runs the real BG worklet loader over every workspace package's source,
 * reads each placeholder's `_c`, resolves every captured name back to its
 * declaration (following imports and re-exports across the workspace), and
 * fails on any of these hazards.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import workletLoader from '../src/loaders/worklet-loader';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const PACKAGES = join(ROOT, 'packages');
const DIRECTIVE_RE = /['"]main thread['"]\s*(?:;|\n)/;

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
    }
    return out;
}

function workspaceSources(): string[] {
    const out: string[] = [];
    for (const pkg of readdirSync(PACKAGES)) {
        const src = join(PACKAGES, pkg, 'src');
        if (existsSync(src)) walk(src, out);
    }
    return out;
}

function bgTransform(file: string, source: string): string {
    return workletLoader.call({
        resourcePath: file,
        cacheable: () => {},
        emitError: (e: Error) => { throw e; },
    } as never, source);
}

const astCache = new Map<string, ts.SourceFile>();
function parse(file: string, text = readFileSync(file, 'utf8')): ts.SourceFile {
    const key = `${file}\0${text.length}`;
    let sf = astCache.get(key);
    if (!sf) {
        sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
            file.endsWith('.tsx') || file.endsWith('.js') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        astCache.set(key, sf);
    }
    return sf;
}

/**
 * `./x.js` / `@sigx/lynx-core` / `@sigx/lynx-zero/testing` → a workspace
 * source file. `null` for a module outside the workspace (`@sigx/reactivity`,
 * `@lynx-js/*`, …); `'missing'` for a workspace package path that should
 * resolve but doesn't — reported, so the audit never skips a name silently.
 */
function resolveModule(fromFile: string, spec: string): string | null | 'missing' {
    let base: string;
    if (spec.startsWith('.')) {
        base = resolve(dirname(fromFile), spec).replace(/\.(js|ts|tsx)$/, '');
    } else {
        const m = /^@sigx\/([^/]+)(?:\/(.+))?$/.exec(spec);
        if (!m || !existsSync(join(PACKAGES, m[1]!, 'src'))) return null;
        base = join(PACKAGES, m[1]!, 'src', (m[2] ?? 'index').replace(/\.(js|ts|tsx)$/, ''));
    }
    for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
        if (existsSync(cand)) return cand;
    }
    return 'missing';
}

type Decl =
    | { kind: 'function'; worklet: boolean; where: string }
    | { kind: 'other' }
    | { kind: 'unresolved'; missing?: string };

function isWorkletBody(body: ts.Node | undefined): boolean {
    if (!body || !ts.isBlock(body)) return false;
    const first = body.statements[0];
    return !!first && ts.isExpressionStatement(first)
        && ts.isStringLiteral(first.expression) && first.expression.text === 'main thread';
}

function classifyInitializer(init: ts.Expression | undefined, where: string): Decl {
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
        return { kind: 'function', worklet: isWorkletBody(init.body), where };
    }
    return { kind: 'other' };
}

const hasExport = (n: ts.Node): boolean =>
    !!(ts.canHaveModifiers(n) && ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));

/** Resolve `name` as a module-scope binding of `file` (local or imported). */
function resolveLocal(file: string, name: string, seen: Set<string>): Decl | null {
    const sf = parse(file);
    const where = relative(ROOT, file);
    for (const st of sf.statements) {
        if (ts.isFunctionDeclaration(st) && st.name?.text === name) {
            return { kind: 'function', worklet: isWorkletBody(st.body), where };
        }
        if (ts.isVariableStatement(st)) {
            for (const d of st.declarationList.declarations) {
                if (ts.isIdentifier(d.name) && d.name.text === name) return classifyInitializer(d.initializer, where);
            }
        }
        if ((ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && st.name?.text === name) return { kind: 'other' };
        if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
            const bindings = st.importClause?.namedBindings;
            if (bindings && ts.isNamedImports(bindings)) {
                for (const el of bindings.elements) {
                    if (el.name.text !== name) continue;
                    const target = resolveModule(file, st.moduleSpecifier.text);
                    if (target === 'missing') return { kind: 'unresolved', missing: st.moduleSpecifier.text };
                    if (!target) return { kind: 'unresolved' };
                    return resolveExport(target, (el.propertyName ?? el.name).text, seen);
                }
            }
        }
    }
    return null;
}

/** Resolve the export `name` of `file`, following re-exports. */
function resolveExport(file: string, name: string, seen = new Set<string>()): Decl {
    const key = `${file}#${name}`;
    if (seen.has(key)) return { kind: 'unresolved' };
    seen.add(key);
    const sf = parse(file);
    const stars: string[] = [];
    for (const st of sf.statements) {
        if (ts.isExportDeclaration(st)) {
            const from = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)
                ? st.moduleSpecifier.text : null;
            if (!st.exportClause) { if (from) stars.push(from); continue; }
            if (ts.isNamedExports(st.exportClause)) {
                for (const el of st.exportClause.elements) {
                    if (el.name.text !== name) continue;
                    const orig = (el.propertyName ?? el.name).text;
                    if (from) {
                        const target = resolveModule(file, from);
                        if (target === 'missing') return { kind: 'unresolved', missing: from };
                        return target ? resolveExport(target, orig, seen) : { kind: 'unresolved' };
                    }
                    return resolveLocal(file, orig, seen) ?? { kind: 'unresolved' };
                }
            }
        } else if (hasExport(st)) {
            const local = resolveLocal(file, name, seen);
            if (local) return local;
        }
    }
    for (const from of stars) {
        const target = resolveModule(file, from);
        if (!target || target === 'missing') continue;
        const d = resolveExport(target, name, seen);
        if (d.kind !== 'unresolved') return d;
    }
    return { kind: 'unresolved' };
}

interface Capture {
    name: string;
    copiedObject: boolean;
    /** Dotted paths the transform copied member-by-member (`KINDS.indexOf`). */
    members: string[];
}

/** Leaf paths of a copied-object capture: `{ a: { b: X.a.b } }` → `['a.b']`. */
function leafPaths(obj: ts.ObjectLiteralExpression, prefix = ''): string[] {
    const out: string[] = [];
    for (const p of obj.properties) {
        if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
        const path = prefix ? `${prefix}.${p.name.text}` : p.name.text;
        if (ts.isObjectLiteralExpression(p.initializer)) out.push(...leafPaths(p.initializer, path));
        else out.push(path);
    }
    return out;
}

/** Every `_c` entry of every `{ _wkltId }` placeholder in a BG output. */
function captures(file: string, bg: string): Capture[] {
    const out: Capture[] = [];
    const visit = (n: ts.Node): void => {
        if (ts.isObjectLiteralExpression(n)) {
            const props = n.properties;
            const isPlaceholder = props.some((p) => p.name && ts.isIdentifier(p.name) && p.name.text === '_wkltId');
            const c = props.find((p): p is ts.PropertyAssignment =>
                ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === '_c');
            if (isPlaceholder && c && ts.isObjectLiteralExpression(c.initializer)) {
                for (const p of c.initializer.properties) {
                    if (ts.isShorthandPropertyAssignment(p)) {
                        out.push({ name: p.name.text, copiedObject: false, members: [] });
                    } else if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) {
                        const copied = ts.isObjectLiteralExpression(p.initializer);
                        out.push({
                            name: p.name.text,
                            copiedObject: copied,
                            members: copied ? leafPaths(p.initializer as ts.ObjectLiteralExpression) : [],
                        });
                    }
                }
            }
        }
        ts.forEachChild(n, visit);
    };
    visit(parse(`${file}.bg.tsx`, bg));
    return out;
}

interface Finding { file: string; name: string; problem: string }

function audit(files: string[]): Finding[] {
    const findings: Finding[] = [];
    for (const file of files) {
        const source = readFileSync(file, 'utf8');
        if (!DIRECTIVE_RE.test(source)) continue;
        const rel = relative(ROOT, file);
        const seenNames = new Set<string>();
        for (const cap of captures(file, bgTransform(file, source))) {
            if (cap.copiedObject) {
                // The transform copies only the members a worklet touches, as
                // `{ indexOf: KINDS.indexOf }` — so a member the worklet CALLS
                // is a function in `_c`, dropped on the wire: `KINDS.indexOf`
                // threw `not a function` on iOS (#1201), and the same goes
                // for any method on a captured object.
                for (const m of cap.members) {
                    const call = new RegExp(`\\b${cap.name}\\.${m.replace(/\./g, '\\.')}\\s*\\(`);
                    const key = `call:${cap.name}.${m}`;
                    if (call.test(source) && !seenNames.has(key)) {
                        seenNames.add(key);
                        findings.push({ file: rel, name: `${cap.name}.${m}`,
                            problem: 'calls a method of a captured object — the method is dropped on the way to MT; use a \'main thread\' function or inline it' });
                    }
                }
                // A plain object captured by value: fine if read-only, wrong if
                // any worklet writes to it (each worklet has its own copy).
                const write = new RegExp(`\\b${cap.name}\\.[A-Za-z_$][\\w$]*\\s*(?:[-+*/]?=(?!=)|\\+\\+|--)`);
                if (write.test(source) && !seenNames.has(`obj:${cap.name}`)) {
                    seenNames.add(`obj:${cap.name}`);
                    findings.push({ file: rel, name: cap.name,
                        problem: 'plain object mutated in a worklet is copied per worklet — use useMainThreadRef' });
                }
                continue;
            }
            if (seenNames.has(cap.name)) continue;
            seenNames.add(cap.name);
            const decl = resolveLocal(file, cap.name, new Set());
            if (decl?.kind === 'function' && !decl.worklet) {
                findings.push({ file: rel, name: cap.name,
                    problem: `captures plain function (declared in ${decl.where}) — mark it 'main thread'` });
            } else if (decl?.kind === 'unresolved' && decl.missing) {
                findings.push({ file: rel, name: cap.name,
                    problem: `cannot resolve workspace import '${decl.missing}' — the audit would skip this capture` });
            }
        }
    }
    return findings;
}

describe('worklet capture audit (#1201)', () => {
    it('flags a captured plain function and a per-worklet-copied mutable object (negative control)', () => {
        // Proves the audit can fail: a fixture shaped like the pre-fix
        // EdgeBackHandle (plain-function helper + plain-object gesture state).
        const dir = mkdtempSync(join(tmpdir(), 'sigx-wklt-audit-'));
        try {
            writeFileSync(join(dir, 'helper.ts'), 'export function plainWidth(): number { return 400; }\n'
                + "export function mtWidth(): number { 'main thread'; return 400; }\n"
                + "export const KINDS = ['a', 'b'] as const;\n");
            const fixture = join(dir, 'Edge.tsx');
            writeFileSync(fixture, `
                import { Gesture } from '@sigx/lynx';
                import { plainWidth, mtWidth, KINDS } from './helper.js';
                export function make() {
                    const state = { start: 0 };
                    return Gesture.Pan()
                        .onStart((e: any) => { 'main thread'; state.start = e.x; })
                        .onUpdate((e: any) => { 'main thread'; return (e.x - state.start) / plainWidth() / mtWidth(); })
                        .onEnd((e: any) => { 'main thread'; return KINDS.indexOf(e.kind); });
                }
            `);
            const found = audit([fixture]).map((f) => `${f.name}: ${f.problem.split(' — ')[0]}`);
            expect(found).toEqual([
                'state: plain object mutated in a worklet is copied per worklet',
                expect.stringMatching(/^plainWidth: captures plain function/),
                expect.stringMatching(/^KINDS\.indexOf: calls a method of a captured object/),
            ]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('resolves the real EdgeBackHandle captures to worklet-safe declarations', () => {
        const file = join(PACKAGES, 'lynx-navigation', 'src', 'components', 'EdgeBackHandle.tsx');
        const decl = resolveLocal(file, 'screenWidthMT', new Set());
        expect(decl).toMatchObject({ kind: 'function', worklet: true });
        // Through @sigx/lynx-motion's barrel re-export.
        expect(resolveLocal(file, 'withTiming', new Set())).toMatchObject({ kind: 'function', worklet: true });
        // And one hop further: what screenWidthMT itself captures.
        const helper = join(PACKAGES, 'lynx-navigation', 'src', 'internal', 'screen-width.ts');
        expect(resolveLocal(helper, 'useScreenMT', new Set())).toMatchObject({ kind: 'function', worklet: true });
    });

    it('no workspace worklet captures a plain function or copies mutable state', () => {
        const findings = audit(workspaceSources())
            .map((f) => `${f.file}: ${f.name} — ${f.problem}`);
        expect(findings).toEqual([]);
    });
});
