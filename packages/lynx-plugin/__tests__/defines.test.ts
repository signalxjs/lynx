/**
 * Tests for the per-layer `__MAIN_THREAD__` / `__BACKGROUND__` build defines
 * (#623, phase 0 of #620).
 *
 * The defines fold via the transform's `defineDCE` pass inside the two
 * worklet loaders — BG folds `{__MAIN_THREAD__: false, __BACKGROUND__: true}`,
 * MT the inverse. Key contracts:
 *   - each layer's output contains only its own branch, and neither token
 *     survives into any output
 *   - worklet ids stay identical across the BG and MT transforms even when
 *     the worklet body contains define-gated branches (the content hash is
 *     computed pre-DCE)
 *   - library files keep today's passthrough semantics (defines are
 *     app/workspace-src only)
 */

import { describe, it, expect } from 'vitest';
import workletLoader from '../src/loaders/worklet-loader';
import workletLoaderMT from '../src/loaders/worklet-loader-mt';

function createCtx(resourcePath: string) {
  return {
    resourcePath,
    cacheable: () => {},
    emitError: (e: Error) => { throw e; },
  } as any;
}

function bg(source: string, resourcePath = '/app/src/component.tsx'): string {
  return workletLoader.call(createCtx(resourcePath), source);
}

function mt(source: string, resourcePath = '/app/src/component.tsx'): string {
  return workletLoaderMT.call(createCtx(resourcePath), source);
}

const BRANCHED = `
export function setup() {
  if (__BACKGROUND__) { installBackgroundProbe(); }
  if (__MAIN_THREAD__) { installMainThreadProbe(); }
  return __BACKGROUND__ ? 'bg' : 'mt';
}
`;

describe('per-layer defines (BG loader)', () => {
  it('folds branches to the BG values and strips both tokens', () => {
    const out = bg(BRANCHED, '/app/src/setup.ts');
    expect(out).toContain('installBackgroundProbe()');
    expect(out).not.toContain('installMainThreadProbe');
    expect(out).toContain("'bg'");
    expect(out).not.toMatch(/__MAIN_THREAD__|__BACKGROUND__/);
  });

  it('triggers the transform on a define alone — no worklet directive needed', () => {
    // The pre-filter must accept define-only files; before #623 this file
    // would have passed through with the bare tokens intact and thrown a
    // ReferenceError at runtime.
    const source = `export const mode = __BACKGROUND__ ? 'bg' : 'mt';`;
    const out = bg(source, '/app/src/mode.ts');
    expect(out).toContain("'bg'");
    expect(out).not.toMatch(/__MAIN_THREAD__|__BACKGROUND__/);
  });

  it('still passes through files with neither directive nor define', () => {
    const source = `export const x = 1;`;
    expect(bg(source)).toBe(source);
  });

  it('folds defines while preserving JSX for the downstream SWC pass', () => {
    const source = `
      export function Panel({ items }: { items: string[] }) {
        if (__BACKGROUND__) { report(items.length); }
        return <view class="panel">{items.map((it) => <text key={it}>{it}</text>)}</view>;
      }
    `;
    const out = bg(source, '/app/src/Panel.tsx');
    expect(out).toContain('report(items.length)');
    expect(out).toContain('<view class="panel">');
    expect(out).not.toMatch(/__MAIN_THREAD__|__BACKGROUND__/);
  });
});

describe('per-layer defines (MT loader)', () => {
  const WORKLET_WITH_DEFINES = `
    export function MyComp() {
      return _jsx('view', {
        'main-thread-bindtap': (e) => {
          'main thread';
          if (__MAIN_THREAD__) { mtBranch(e); }
          if (__BACKGROUND__) { bgBranch(e); }
        },
      });
    }
  `;

  it('keeps only the __MAIN_THREAD__ branch inside registered worklet bodies', () => {
    const out = mt(WORKLET_WITH_DEFINES);
    expect(out).toContain('registerWorkletInternal');
    expect(out).toContain('mtBranch(e)');
    expect(out).not.toContain('bgBranch(e)');
    expect(out).not.toMatch(/__MAIN_THREAD__|__BACKGROUND__/);
  });

  it('produces the same _wkltId on both layers when the body contains defines', () => {
    // Worklet ids are content-hash-derived and computed pre-DCE; folding
    // different define values per layer must not desync them, or BG
    // placeholders would reference an id the MT never registered.
    const bgOut = bg(WORKLET_WITH_DEFINES);
    const mtOut = mt(WORKLET_WITH_DEFINES);
    const bgId = bgOut.match(/_wkltId:\s*"([^"]+)"/)?.[1];
    expect(bgId).toBeTruthy();
    expect(mtOut).toContain(`"${bgId}"`);
  });

  it('drops define-bearing bodies of no-directive user files along with everything else', () => {
    const out = mt(BRANCHED, '/app/src/setup.ts');
    expect(out).not.toMatch(/__MAIN_THREAD__|__BACKGROUND__/);
    expect(out).not.toContain('installMainThreadProbe');
  });

  it('leaves no-directive library files untouched, tokens and all', () => {
    // Documented constraint: defines are app/workspace-src only. Library
    // dists pass through the MT layer verbatim (cross-layer module
    // identity), so their tokens must survive byte-for-byte — a package
    // shipping them is a bug on the package's side, not something the
    // loader may silently rewrite.
    const source = `export const mode = __BACKGROUND__ ? 'bg' : 'mt';`;
    const out = mt(source, '/app/node_modules/@sigx/lynx-thing/dist/index.js');
    expect(out).toBe(source);
  });
});
