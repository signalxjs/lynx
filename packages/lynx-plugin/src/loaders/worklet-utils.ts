/**
 * Helpers shared by worklet-loader (BG) and worklet-loader-mt (MT).
 *
 * Mirrors vue-lynx's `worklet-utils.ts` minus the `?vue` sub-module logic
 * (sigx has no Vue Single-File-Component pipeline) and minus the
 * `extractSharedImports` path (deferred to Phase 1c — see plan).
 */

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
 */
export function extractRegistrations(lepusCode: string): string {
  const out: string[] = [];
  const marker = 'registerWorkletInternal(';
  let from = 0;

  while (true) {
    const idx = lepusCode.indexOf(marker, from);
    if (idx === -1) break;

    let depth = 0;
    let i = idx + marker.length - 1; // points at the opening '('
    for (; i < lepusCode.length; i++) {
      const ch = lepusCode[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) break;
      }
    }

    let end = i + 1;
    if (end < lepusCode.length && lepusCode[end] === ';') end++;
    out.push(lepusCode.slice(idx, end));
    from = end;
  }

  return out.join('\n');
}
