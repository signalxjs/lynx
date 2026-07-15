/**
 * Tests for the `snapshots` loader flag (#635, phase 4b of #620).
 *
 * Loaders are exercised as pure source→string functions (worklet-loader.test.ts
 * pattern) with `getOptions()` supplying the flag. Key contracts:
 *   - flag OFF → byte-identical output to today on both loaders
 *   - BG: JSX lowers to `_jsx(__snapshot_…)` + null-body registrations
 *   - MT: registrations extracted with REAL create bodies, bound to the
 *     `__sigxSnapshotInternal` global, component bodies dropped
 *   - template uniqIDs identical across the two independent layer transforms
 *   - library dists untouched with the flag on
 */

import { describe, it, expect } from 'vitest';
import workletLoader from '../src/loaders/worklet-loader';
import workletLoaderMT from '../src/loaders/worklet-loader-mt';
import {
  detectSnapshotNamespace,
  extractSnapshotRegistrations,
} from '../src/loaders/worklet-utils';

function createCtx(resourcePath: string, snapshots: boolean) {
  return {
    resourcePath,
    cacheable: () => {},
    emitError: (e: Error) => { throw e; },
    getOptions: () => ({ snapshots }),
  } as any;
}

function bg(source: string, resourcePath = '/app/src/Cell.tsx', snapshots = true): string {
  return workletLoader.call(createCtx(resourcePath, snapshots), source);
}

function mt(source: string, resourcePath = '/app/src/Cell.tsx', snapshots = true): string {
  return workletLoaderMT.call(createCtx(resourcePath, snapshots), source);
}

const CELL = `
export function Cell({ label, onTap }) {
  return (
    <view class="cell" bindtap={onTap}>
      <text class="t(1)">{label}</text>
    </view>
  );
}
`;

const CELL_WITH_WORKLET = `
export function Cell({ label }) {
  return (
    <view
      class="cell"
      main-thread-bindtap={(e) => {
        'main thread';
        console.log('tap', e);
      }}
    >
      <text>{label}</text>
    </view>
  );
}
`;

function snapshotIds(code: string): string[] {
  return [...new Set(code.match(/__snapshot_[A-Za-z0-9_]+/g) ?? [])].sort();
}

describe('snapshots flag OFF (default)', () => {
  it('BG and MT outputs are byte-identical to today for a JSX+worklet file', () => {
    const bgOff = bg(CELL_WITH_WORKLET, '/app/src/Cell.tsx', false);
    const mtOff = mt(CELL_WITH_WORKLET, '/app/src/Cell.tsx', false);
    // Off = the pre-#635 behavior: worklet transform only, JSX preserved on
    // BG, extraction-only on MT, zero snapshot artifacts anywhere.
    expect(bgOff).not.toContain('__snapshot_');
    expect(bgOff).toContain('<view');
    expect(mtOff).not.toContain('snapshotCreatorMap');
    expect(mtOff).toContain('registerWorkletInternal');
  });

  it('plain JSX file without directives passes through on BG', () => {
    expect(bg(CELL, '/app/src/Cell.tsx', false)).toBe(CELL);
  });

  it('flag-off output is string-equal to options-omitted output on both loaders', () => {
    // The real default path passes NO options object at all — assert full
    // string equality, not substrings, so any accidental divergence in the
    // off state fails loudly.
    const noOptsCtx = (path: string) => ({
      resourcePath: path,
      cacheable: () => {},
      emitError: (e: Error) => { throw e; },
      emitWarning: () => {},
      getOptions: () => ({}),
      mode: 'production',
    } as any);
    for (const src of [CELL, CELL_WITH_WORKLET, 'export const x = 1;']) {
      expect(workletLoader.call(noOptsCtx('/app/src/F.tsx'), src))
        .toBe(bg(src, '/app/src/F.tsx', false));
      expect(workletLoaderMT.call(noOptsCtx('/app/src/F.tsx'), src))
        .toBe(mt(src, '/app/src/F.tsx', false));
    }
  });
});

describe('snapshots flag ON — BG loader', () => {
  it('lowers JSX to _jsx(__snapshot_…) with null-body registrations', () => {
    const out = bg(CELL);
    expect(out).toContain('snapshotCreatorMap[');
    expect(out).toMatch(/createSnapshot\(__snapshot_[A-Za-z0-9_]+, null, null/);
    expect(out).toMatch(/_jsx\(__snapshot_/);
    expect(out).toContain('from "@sigx/lynx/jsx-runtime"');
    expect(out).not.toContain('<view');
  });

  it('injects globDynamicComponentEntry (no free identifier remains)', () => {
    const out = bg(CELL);
    expect(out).not.toMatch(/\bglobDynamicComponentEntry\b/);
  });

  it('leaves library dists with pre-lowered _jsx() calls untouched', () => {
    const dist = `import { jsx as _jsx } from "@sigx/lynx/jsx-runtime";
export function Chip(props) { return _jsx('view', { class: 'chip' }); }
`;
    const p = '/app/node_modules/@sigx/lynx-daisyui/dist/Chip.js';
    expect(bg(dist, p)).toBe(dist);
    expect(mt(dist, p)).toBe(dist);
  });
});

describe('snapshots flag ON — MT loader', () => {
  it('emits preamble + global binding + registrations with real create bodies, no component body', () => {
    const out = mt(CELL);
    expect(out).toContain('entry-main.js');
    expect(out).toContain('globalThis.__sigxSnapshotInternal');
    expect(out).toContain('snapshotCreatorMap[');
    expect(out).toContain('__CreateView');
    expect(out).toContain('const __snapshot_');
    expect(out).not.toContain('export function');
    expect(out).not.toContain('_jsx(');
    expect(out).not.toMatch(/\bglobDynamicComponentEntry\b/);
  });

  it('produces the same template ids as the BG loader', () => {
    const bgIds = snapshotIds(bg(CELL));
    const mtIds = snapshotIds(mt(CELL));
    expect(bgIds.length).toBeGreaterThan(0);
    expect(mtIds).toEqual(bgIds);
  });

  it('worklet + snapshot coexistence: both id kinds match across loaders', () => {
    const bgOut = bg(CELL_WITH_WORKLET);
    const mtOut = mt(CELL_WITH_WORKLET);
    // Worklet id from the BG placeholder appears in the MT registration.
    const wkltId = bgOut.match(/_wkltId:\s*"([^"]+)"/)?.[1];
    expect(wkltId).toBeTruthy();
    expect(mtOut).toContain(`"${wkltId}"`);
    // Template ids match too.
    expect(snapshotIds(mtOut)).toEqual(snapshotIds(bgOut));
    expect(mtOut).toContain('registerWorkletInternal');
    expect(mtOut).toContain('snapshotCreatorMap[');
  });

  it('survives attribute strings full of brackets/parens/quotes in create bodies', () => {
    const nasty = `
export function Nasty() {
  return (
    <view class={'g(1)[2]{3}'} data-x={"), ] end"}>
      <text class="a(b"></text>
    </view>
  );
}
`;
    const out = mt(nasty, '/app/src/Nasty.tsx');
    expect(out).toContain('snapshotCreatorMap[');
    // The registration slice is complete (balanced): it ends with the
    // lazy-creator arg list closed and the statement terminated.
    expect(out).toMatch(/true\);\s*$/m);
    expect(out).toContain('g(1)[2]{3}');
  });

  it('extracts multiple templates per file in order', () => {
    const two = `
export function A() { return <view class="a" />; }
export function B() { return <text class="b">x</text>; }
`;
    const out = mt(two, '/app/src/Two.tsx');
    const assignments = out.match(/snapshotCreatorMap\[/g) ?? [];
    expect(assignments.length).toBe(2);
    // Each const decl precedes its assignment.
    const ids = snapshotIds(out);
    for (const id of ids) {
      expect(out.indexOf(`const ${id} = `)).toBeLessThan(out.indexOf(`snapshotCreatorMap[${id}]`));
    }
  });

  it('handles a user file that shadows the ReactLynx binding name', () => {
    const shadowed = `
const ReactLynx = { custom: true };
export function Cell() { return <view class="c">{String(ReactLynx.custom)}</view>; }
`;
    const out = mt(shadowed, '/app/src/Shadowed.tsx');
    // The transform renames its namespace import on collision; detection
    // must follow the rename, and the binding line must use the same local.
    const ns = out.match(/const (\w+) = globalThis\.__sigxSnapshotInternal/)?.[1];
    expect(ns).toBeTruthy();
    expect(out).toContain(`${ns}.snapshotCreatorMap[`);
  });
});

describe('unsupported JSX fallback', () => {
  it('files with use:* directive attrs keep the per-element path on both loaders', () => {
    // The upstream WASM snapshot pass panics on sigx's `use:*` namespace
    // (RuntimeError: unreachable) — such files skip lowering wholesale and
    // keep today's behavior, symmetrically on both layers.
    const src = `
export function Toggle({ shown }) {
  return <view use:show={shown} class="rounded-box" />;
}
`;
    const bgOut = bg(src, '/app/src/Toggle.tsx');
    expect(bgOut).not.toContain('__snapshot_');
    expect(bgOut).toContain('use:show');
    const mtOut = mt(src, '/app/src/Toggle.tsx');
    expect(mtOut).not.toContain('snapshotCreatorMap');
    expect(mtOut).toContain('entry-main.js'); // normal body-drop path
  });

  it('files with raw <list> JSX keep the per-element path until list templates land', () => {
    // A compiled <list> template's create() calls snapshotCreateList, which
    // the MT runtime rejects until #620 phase 5 — the whole file falls back.
    const src = `
export function Rows({ items }) {
  return (
    <list list-type="single">
      {items.map((it) => <list-item item-key={it} key={it}><text>{it}</text></list-item>)}
    </list>
  );
}
`;
    const bgOut = bg(src, '/app/src/Rows.tsx');
    expect(bgOut).not.toContain('__snapshot_');
    expect(bgOut).toContain('<list');
    const mtOut = mt(src, '/app/src/Rows.tsx');
    expect(mtOut).not.toContain('snapshotCreatorMap');
  });
});

describe('extraction helpers', () => {
  it('detectSnapshotNamespace finds the emitted namespace local', () => {
    const code = `import * as Zed from "@sigx/lynx/internal";\nZed.snapshotCreatorMap[x] = 1;`;
    expect(detectSnapshotNamespace(code, '@sigx/lynx/internal')).toBe('Zed');
    expect(detectSnapshotNamespace('const a = 1;', '@sigx/lynx/internal')).toBeNull();
  });

  it('extractSnapshotRegistrations slices balanced statements only', () => {
    const code = [
      'import * as R from "@sigx/lynx/internal";',
      'const __snapshot_x_1 = "__snapshot_x_1";',
      'R.snapshotCreatorMap[__snapshot_x_1] = (__snapshot_x_1)=>R.createSnapshot(__snapshot_x_1, function() {',
      '  const el = __CreateView(R.__pageId);',
      '  __SetClasses(el, "weird)(string]");',
      '  return [el];',
      '}, null, null, undefined, \'__sigx__\', null, true);',
      'export function Comp() { return 1; }',
    ].join('\n');
    const out = extractSnapshotRegistrations(code, 'R');
    expect(out).toContain('const __snapshot_x_1');
    expect(out).toContain('weird)(string]');
    expect(out.trim().endsWith('true);')).toBe(true);
    expect(out).not.toContain('export function');
  });
});

describe('stripJsComments string-awareness (via extraction)', () => {
  it('does not corrupt attribute strings that look like comments', () => {
    const src = `
export function Weird() {
  return <view class="a //b" accessibility-label={"/* not a comment */"}><text>x</text></view>;
}
`;
    const out = mt(src, '/app/src/Weird.tsx');
    expect(out).toContain('snapshotCreatorMap');
    expect(out).toContain('a //b');
    expect(out).toContain('/* not a comment */');
  });
});
