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
  // Two passes — block comments first, then line comments. Block-first
  // is important: a `// inside */` sequence inside a `/* ... */` block
  // would otherwise have the inner `//` eaten by the line-comment pass
  // before the outer block is matched, leaving stray `*/` in the output.
  // We don't try to be string-literal-aware (a comment-looking sequence
  // inside a string would be wrongly stripped) because:
  //   1. The input is SWC output, which doesn't put `//` or `/* */` inside
  //      strings except in trivial constant cases we don't care about.
  //   2. `extractRegistrations` only cares about call shapes; the surrounding
  //      code is discarded anyway.
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

export function extractRegistrations(lepusCode: string): string {
  const code = stripJsComments(lepusCode);
  const out: string[] = [];
  const marker = 'registerWorkletInternal(';
  let from = 0;

  while (true) {
    const idx = code.indexOf(marker, from);
    if (idx === -1) break;

    let depth = 0;
    let i = idx + marker.length - 1; // points at the opening '('
    for (; i < code.length; i++) {
      const ch = code[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) break;
      }
    }

    let end = i + 1;
    if (end < code.length && code[end] === ';') end++;
    out.push(code.slice(idx, end));
    from = end;
  }

  return out.join('\n');
}
