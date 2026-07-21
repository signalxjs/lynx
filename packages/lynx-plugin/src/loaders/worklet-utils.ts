/**
 * Helpers shared by worklet-loader (BG) and worklet-loader-mt (MT).
 *
 * Mirrors vue-lynx's `worklet-utils.ts` minus the `?vue` sub-module logic
 * (sigx has no Vue Single-File-Component pipeline) and minus the
 * `extractSharedImports` path (deferred to Phase 1c — see plan).
 */

/**
 * Per-layer thread defines (#623, phase 0 of #620).
 *
 * `__MAIN_THREAD__` / `__BACKGROUND__` fold to literals per bundle layer via
 * the transform's `defineDCE` pass — NOT rspack's DefinePlugin, which is
 * compilation-wide (it cannot be scoped to a layer) and runs after loaders.
 * `defineDCE` runs before the worklet pass, so a `'main thread'` function
 * body is folded with the MT values in its registered (MT) form and with the
 * BG values everywhere else — each branch of `if (__MAIN_THREAD__)` lands
 * only in the bundle that can execute it.
 *
 * Scope: app/workspace-src code only. Published dists pass through the MT
 * layer verbatim (library-preserve branch — cross-layer module identity), so
 * a bare `__MAIN_THREAD__` token in a dist would throw at MT runtime.
 * Libraries need a runtime check instead.
 *
 * Both loaders must fold the exact same identifier set — worklet/snapshot
 * content hashes are computed on the pre-DCE source, so defines are
 * ID-neutral, but an asymmetric define set would still desync outputs.
 */
export const DEFINE_RE = /__MAIN_THREAD__|__BACKGROUND__/;

/**
 * Library paths (`node_modules/` and any `dist/`). Shared by both loaders:
 * the MT loader's body-preserve branches key on it (see worklet-loader-mt.ts
 * header), and both loaders exempt library files from define folding — a
 * dist that merely MENTIONS a define token (e.g. in an error string) must
 * not be reparsed or rewritten.
 */
export const LIBRARY_PATH_RE = /[\\/](?:node_modules|dist)[\\/]/;

export const BG_DEFINES = {
  __MAIN_THREAD__: 'false',
  __BACKGROUND__: 'true',
} as const;

export const MT_DEFINES = {
  __MAIN_THREAD__: 'true',
  __BACKGROUND__: 'false',
} as const;

/**
 * Extract import statements whose target may contain `'main thread'` worklets
 * the MT bundle needs to register.
 *
 * Two import flavours qualify:
 *   - Relative paths (`./foo`, `../bar`) — user code split across files.
 *   - `@sigx/*` package paths — workspace component packages like
 *     `@sigx/gestures` that ship `<Pressable>`/`<Draggable>` etc. These resolve
 *     to workspace `src/` (not node_modules) so the MT loader's rule still
 *     processes them; we just need to preserve the edge so rspack walks there.
 *
 * Converts named/default/namespace imports to side-effect-only imports
 * (`import '@sigx/gestures';`) so webpack still follows the dependency graph
 * without executing user code on the MT layer.
 *
 * Critical for the MT loader: an entry like `main.tsx` may not contain any
 * `'main thread'` directives itself, but it imports route/component files
 * that do. Without preserving these edges, webpack would never reach the
 * files with worklet registrations and MT-side hydration of BG worklet ctxs
 * would throw "cannot read property bind of undefined" when the unregistered
 * _wkltId is looked up in `lynxWorkletImpl._workletMap`.
 */
export function extractLocalImports(source: string): string {
  // Strip line and block comments so docstring examples like
  // `* import X from './foo'` don't get parsed as real imports.
  // String contents are left intact (we still catch `import './foo'` inside
  // a string template), but real source rarely encodes import-statement
  // shapes inside strings, and the false-positive rate with comments stripped
  // is acceptable for this preserve-edges-only loader.
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  const specifiers = new Set<string>();

  // Relative paths (./foo, ../bar) and @sigx/* package paths.
  const re = /(?:from|import)\s+['"]((?:\.[^'"]+)|(?:@sigx\/[^'"]+))['"]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripped)) !== null) {
    specifiers.add(match[1]!);
  }

  if (specifiers.size === 0) return '';
  return [...specifiers].map((s) => `import '${s}';`).join('\n');
}

/**
 * Extract `registerWorkletInternal(...)` calls from a LEPUS-target transform output.
 *
 * Upstream's LEPUS output includes:
 *   - `import { loadWorkletRuntime as __loadWorkletRuntime } from "<runtimePkg>";`
 *   - `var loadWorkletRuntime = __loadWorkletRuntime;`
 *   - the original component code (which we drop — never invoked on MT)
 *   - `const __workletRuntimeLoaded = loadWorkletRuntime(...);`
 *   - `__workletRuntimeLoaded && registerWorkletInternal("main-thread", "<id>", function(...) { ... });`
 *
 * We only need the `registerWorkletInternal(...)` calls — the loadWorkletRuntime
 * gating is redundant because we only inject the calls when the MT bundle is
 * actually being built. Bracket-depth counting handles nested braces in the
 * function body.
 *
 * SWC's LEPUS transform preserves JSDoc / comments verbatim. When source code
 * carries documentation that *mentions* the literal token
 * `registerWorkletInternal(...)` (as `lynx-runtime`'s `threading.ts` does), a
 * naive scan would extract that doc text as a "registration" and append it to
 * the MT bundle as invalid JS (`function(...) { ... }` isn't real syntax).
 * Strip comments before scanning so only real statements survive.
 */
function stripJsComments(code: string): string {
  // Single-pass, string-literal-aware scanner. Snapshot create bodies embed
  // arbitrary user attribute strings (a className of "a //b" or "/*x*/" is
  // legal), so regex stripping would corrupt literals before the extraction
  // slices run. Comments are replaced with a single space to keep token
  // separation; newlines inside block comments are preserved for line
  // stability. Template-literal `${}` interpolation is handled with a small
  // depth counter.
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

/**
 * Scan from `open` (an opening `(` or `[`) to the index of its balancing
 * closer, skipping string literals ('…', "…", `…` incl. escapes). String
 * awareness matters for snapshot create bodies, which embed user attribute
 * strings like `__SetClasses(el, "grid(2)")` — a naive counter desyncs on
 * the paren inside the string.
 */
function scanBalanced(code: string, open: number): number {
  const opener = code[open];
  const closer = opener === '(' ? ')' : opener === '[' ? ']' : '}';
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      for (i++; i < code.length; i++) {
        if (code[i] === '\\') i++;
        else if (code[i] === ch) break;
      }
      continue;
    }
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function extractRegistrations(lepusCode: string): string {
  const code = stripJsComments(lepusCode);
  const out: string[] = [];
  const marker = 'registerWorkletInternal(';
  let from = 0;

  while (true) {
    const idx = code.indexOf(marker, from);
    if (idx === -1) break;

    const close = scanBalanced(code, idx + marker.length - 1);
    if (close === -1) break;

    let end = close + 1;
    if (end < code.length && code[end] === ';') end++;
    out.push(code.slice(idx, end));
    from = end;
  }

  return out.join('\n');
}

/**
 * Extract snapshot-template registrations from a LEPUS-target transform
 * output (#635): the id declarations
 *   `const __snapshot_<hash>_<n> = "__snapshot_<hash>_<n>";`
 * and the lazy-creator assignments
 *   `<ns>.snapshotCreatorMap[__snapshot_…] = (id)=><ns>.createSnapshot(…);`
 * where `<ns>` is the namespace local of the emitted
 * `import * as <ns> from '<runtimePkg>'` (the transform renames it when the
 * user shadows the default `ReactLynx` binding — always detect, never
 * hardcode). Statement order is preserved (each const precedes its
 * assignment). The caller binds `<ns>` to `globalThis.__sigxSnapshotInternal`
 * so registrations run without the import — in the static MT bundle and in
 * HMR eval realms alike.
 */
export function extractSnapshotRegistrations(
  lepusCode: string,
  ns: string,
): string {
  const code = stripJsComments(lepusCode);
  const out: string[] = [];

  const declRe = /const (__snapshot_[A-Za-z0-9_]+) = "(?:__snapshot_[A-Za-z0-9_]+)";/g;
  const declByName = new Map<string, string>();
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(code)) !== null) {
    declByName.set(m[1]!, m[0]);
  }

  const marker = `${ns}.snapshotCreatorMap[`;
  let from = 0;
  while (true) {
    const idx = code.indexOf(marker, from);
    if (idx === -1) break;
    const keyClose = scanBalanced(code, idx + marker.length - 1);
    if (keyClose === -1) break;
    const key = code.slice(idx + marker.length, keyClose).trim();

    // The RHS is `= (id)=>ns.createSnapshot( … )` — find the createSnapshot
    // call's balanced close, then the statement terminator. Guard the
    // callee lookup explicitly: indexOf treats fromIndex -1 as 0, which
    // would silently slice from the file's first '('.
    const calleeAt = code.indexOf('createSnapshot', keyClose);
    if (calleeAt === -1) break;
    const callOpen = code.indexOf('(', calleeAt);
    if (callOpen === -1) break;
    const callClose = scanBalanced(code, callOpen);
    if (callClose === -1) break;
    let end = callClose + 1;
    if (end < code.length && code[end] === ';') end++;

    const decl = declByName.get(key);
    if (decl) out.push(decl);
    out.push(code.slice(idx, end));
    from = end;
  }

  return out.join('\n');
}

/**
 * Namespace local of the transform's emitted runtimePkg import
 * (`import * as <ns> from "<pkg>"`), or null when the file registered no
 * snapshots.
 */
export function detectSnapshotNamespace(
  code: string,
  runtimePkg: string,
): string | null {
  const re = new RegExp(
    `import \\* as (\\w+) from ["']${runtimePkg.replace(/[/\\]/g, '\\$&')}["']`,
  );
  return re.exec(code)?.[1] ?? null;
}
