/**
 * Hot-update source extraction helpers for the BG → MT HMR bridge (#637).
 *
 * Pure string functions, side-effect free — split from mt-hmr-bridge.ts so
 * tests can import them without triggering the bridge's dev wiring (which
 * touches `lynx` / `__webpack_require__` free identifiers at module scope).
 * Runtime twins of the build-time extractors in
 * `lynx-plugin/src/loaders/worklet-utils.ts` (duplicated to avoid a
 * runtime → build-time dependency; dev-only code).
 */

/**
 * Extract `registerWorkletInternal(...)` calls from a hot-update body.
 *
 * Mirrors `lynx-plugin/src/loaders/worklet-utils.ts:extractRegistrations`
 * (duplicated here to avoid a runtime → build-time dep). Bracket-depth count
 * handles nested braces in the function body.
 */
export function extractRegistrations(source: string): string {
  const out: string[] = [];
  const marker = 'registerWorkletInternal(';
  let from = 0;

  while (true) {
    const idx = source.indexOf(marker, from);
    if (idx === -1) break;

    const close = scanBalanced(source, idx + marker.length - 1);
    if (close === -1) break;
    let end = close + 1;
    if (end < source.length && source[end] === ';') end++;
    out.push(source.slice(idx, end));
    from = end;
  }

  return out.join('\n');
}

/**
 * String-aware balanced-bracket scan from an opening delimiter; returns the
 * index of its matching close, or -1. Worklet bodies and snapshot create
 * bodies both embed user strings that may contain unbalanced brackets
 * (`"grid(2)"`, `"a["`), so a naive depth counter desyncs.
 * Runtime twin of `lynx-plugin/src/loaders/worklet-utils.ts:scanBalanced`
 * (dev-only code; duplicated to avoid a runtime → build-time dep).
 */
/**
 * True when a `/` at `idx` starts a regex literal rather than division: the
 * previous non-whitespace char is an operator/opener/keyword tail. The usual
 * pragmatic heuristic — full disambiguation needs a tokenizer, and this
 * scanner only guards extraction slicing in dev.
 */
function regexCanStartAt(source: string, idx: number): boolean {
  let j = idx - 1;
  while (j >= 0 && /\s/.test(source[j])) j--;
  if (j < 0) return true;
  const prev = source[j];
  if ('(,=:[!&|?{;+-*%<>^~'.includes(prev)) return true;
  // `return /re/` — check for an identifier tail that is a keyword.
  const tail = /([A-Za-z_$][\w$]*)$/.exec(source.slice(Math.max(0, j - 11), j + 1));
  return tail !== null && /^(?:return|typeof|case|in|of|new|delete|void|do|else)$/.test(tail[1]);
}

export function scanBalanced(source: string, openIdx: number): number {
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
      // Template literal: `${}` interpolation depth AND nested backticks
      // must be tracked — `a${`b`}c` would otherwise end the skip at the
      // inner backtick and desync everything after.
      i++;
      // One expression-depth counter per open template level.
      const tplStack: number[] = [0];
      while (i < source.length && tplStack.length > 0) {
        const t = source[i];
        if (t === '\\') i++;
        else if (t === '$' && source[i + 1] === '{') { tplStack[tplStack.length - 1]++; i++; }
        // ALL braces count inside an open interpolation — `${{a: 1}}` must
        // not close the expression on the object literal's brace.
        else if (t === '{' && tplStack[tplStack.length - 1] > 0) tplStack[tplStack.length - 1]++;
        else if (t === '}' && tplStack[tplStack.length - 1] > 0) tplStack[tplStack.length - 1]--;
        else if (t === '`') {
          if (tplStack[tplStack.length - 1] > 0) tplStack.push(0); // nested opens inside ${}
          else tplStack.pop(); // current template closes
        }
        i++;
      }
      i--; // for-loop increment
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
      // Regex literal — brackets inside (e.g. /\)/ or /[)}]/) must not move
      // the depth counter. Char classes may contain unescaped delimiters.
      i++;
      let inClass = false;
      while (i < source.length && (inClass || source[i] !== '/')) {
        if (source[i] === '\\') i++;
        else if (source[i] === '[') inClass = true;
        else if (source[i] === ']') inClass = false;
        else if (source[i] === '\n') break; // not a regex after all — bail
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

/**
 * Extract snapshot template registrations from a hot-update body and rebind
 * them to the fixed parameter name `__SigxSnap` (the MT handler supplies the
 * contract namespace as that argument — see entry-main.ts).
 *
 * The MT loader emits, per user file:
 *   const <ns> = globalThis.__sigxSnapshotInternal;
 *   const __snapshot_<id> = "__snapshot_<id>";
 *   <ns>.snapshotCreatorMap[__snapshot_<id>] = (…)=><ns>.createSnapshot(…);
 * All three shapes survive webpack module compilation verbatim (dev builds
 * don't minify), so the namespace local is discoverable from the binding
 * line even after bundling.
 */
export function extractSnapshotRegistrations(source: string): string {
  const nsMatch = /const\s+([A-Za-z_$][\w$]*)\s*=\s*globalThis\.__sigxSnapshotInternal\s*;/.exec(source);
  if (!nsMatch) return '';
  const ns = nsMatch[1];

  const out: string[] = [];

  // Const declarations first (each assignment references its const).
  const declRe = /const\s+(__snapshot_[A-Za-z0-9_]+)\s*=\s*"(__snapshot_[A-Za-z0-9_]+)"\s*;/g;
  const seenDecls = new Set<string>();
  for (let m = declRe.exec(source); m; m = declRe.exec(source)) {
    if (m[1] === m[2] && !seenDecls.has(m[1])) {
      seenDecls.add(m[1]);
      out.push(m[0]);
    }
  }

  // Assignments: `<ns>.snapshotCreatorMap[` … balanced to the createSnapshot
  // call's close paren + terminator.
  const marker = `${ns}.snapshotCreatorMap[`;
  let assignments = 0;
  let from = 0;
  while (true) {
    const idx = source.indexOf(marker, from);
    if (idx === -1) break;
    const calleeAt = source.indexOf('createSnapshot', idx);
    if (calleeAt === -1) break;
    const callOpen = source.indexOf('(', calleeAt);
    if (callOpen === -1) break;
    const callClose = scanBalanced(source, callOpen);
    if (callClose === -1) break;
    let end = callClose + 1;
    if (end < source.length && source[end] === ';') end++;
    out.push(source.slice(idx, end));
    assignments++;
    from = end;
  }

  // Decl-only output must not ship: the MT would purge the file's old
  // templates against an incoming set that registers nothing.
  if (assignments === 0 || seenDecls.size === 0) return '';
  // Rebind every `<ns>.` member access to the fixed parameter. The namespace
  // local is a generated identifier — a plain word-boundary replace is safe.
  const nsRe = new RegExp(`\\b${ns.replace(/\$/g, '\\$')}\\.`, 'g');
  return out.join('\n').replace(nsRe, '__SigxSnap.');
}
