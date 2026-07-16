/**
 * #644 — the SHIPPED dist carries working snapshot templates.
 *
 * Imports the real emitted `dist/components/EmojiCell.js` (build the package
 * first — CI builds before testing) and asserts its appended real-body
 * registration materializes through the MT snapshot runtime. This is the
 * end-to-end proof that consuming apps get templated subtrees from this
 * package even though app-build loaders never rewrite library dists.
 */

import { existsSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getSnapshotDef,
  isSnapshotType,
  resetSnapshotRegistry,
  setSnapshotPageId,
  snapshotCreatorMap,
} from '@sigx/lynx-runtime-internal/snapshot';
import {
  createSnapshotInstance,
  flushDirtySlots,
  installSnapshotMTHooks,
  resetSlotStates,
  resetSnapshotInstances,
} from '@sigx/lynx-runtime-main';

const DIST_CELL = new URL('../dist/components/EmojiCell.js', import.meta.url);

type FakeEl = { __id: number; tag: string };
let nextUid = 4000;

beforeEach(() => {
  resetSnapshotRegistry();
  resetSnapshotInstances();
  resetSlotStates();
  nextUid = 4000;
  for (const fn of ['__CreateView', '__CreateText', '__CreateElement']) {
    vi.stubGlobal(fn, vi.fn((..._a: unknown[]) => ({ __id: nextUid++, tag: fn }) as FakeEl));
  }
  vi.stubGlobal('__CreateRawText', vi.fn(() => ({ __id: nextUid++, tag: 'raw' }) as FakeEl));
  vi.stubGlobal('__AppendElement', vi.fn());
  vi.stubGlobal('__SetCSSId', vi.fn());
  vi.stubGlobal('__SetAttribute', vi.fn());
  vi.stubGlobal('__SetClasses', vi.fn());
  vi.stubGlobal('__SetInlineStyles', vi.fn());
  vi.stubGlobal('__AddEvent', vi.fn());
  installSnapshotMTHooks();
  setSnapshotPageId(7);
});

describe('shipped dist templates', () => {
  it('EmojiCell.js registers real-body templates that materialize', async () => {
    // Fail loudly rather than skip: a missing dist means the e2e coverage
    // silently vanishes. CI (and `pnpm test` per repo convention) builds
    // before testing.
    if (!existsSync(DIST_CELL)) {
      throw new Error(
        'dist/components/EmojiCell.js missing — run `pnpm build` (or `pnpm --filter @sigx/lynx-emoji build`) before the test suite',
      );
    }
    await import(/* @vite-ignore */ DIST_CELL.href);
    const ids = Object.keys(snapshotCreatorMap);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(isSnapshotType(id)).toBe(true);
      const inst = createSnapshotInstance(9000 + ids.indexOf(id), id);
      // Real-body registration won over the module code's null-body one —
      // materialization must succeed, not throw "no create()".
      expect(() => inst.ensureElements()).not.toThrow();
      expect(inst.__elements!.length).toBeGreaterThan(0);
    }
  });
});

describe('EmojiCell template shape (#649)', () => {
  it('ships a poolable zero-slot list-item cell with tap/longpress event holes', async () => {
    if (!existsSync(DIST_CELL)) {
      throw new Error('dist missing — run `pnpm build` first');
    }
    // Re-stub creation so elements carry their REAL tag for __GetTag.
    vi.stubGlobal('__CreateElement', vi.fn((tag: string) => ({ __id: nextUid++, tag }) as FakeEl));
    const getTag = (el: unknown): string => (el as FakeEl).tag;
    vi.stubGlobal('__GetTag', vi.fn(getTag));
    const addEvent = vi.fn();
    vi.stubGlobal('__AddEvent', addEvent);

    // Cache-busting query: the first test already imported this module, and
    // the ESM cache would otherwise skip re-running its registrations against
    // the registry `beforeEach` just reset.
    await import(/* @vite-ignore */ DIST_CELL.href + '?shape');
    const ids = Object.keys(snapshotCreatorMap);
    const defs = ids.map((id) => getSnapshotDef(id)!);

    // Exactly one ZERO-SLOT template — the default glyph cell (poolable);
    // the render-prop branch is a separate, slot-bearing template.
    const poolable = defs.filter((d) => !d.slot || d.slot.length === 0);
    const slotted = defs.filter((d) => d.slot && d.slot.length > 0);
    expect(poolable).toHaveLength(1);
    expect(slotted).toHaveLength(1);

    // Both root at <list-item>; the poolable one wires tap + longpress holes.
    for (const def of defs) {
      const inst = createSnapshotInstance(nextUid + 500 + defs.indexOf(def), def.uniqID);
      inst.setValues([
        { 'item-key': 'k', 'estimated-main-axis-size-px': 43 },
        'h1', 'h2', 'sig:tap', 'sig:long', 'h5', 'h6', 'h7',
      ]);
      inst.ensureElements();
      expect(getTag(inst.__element_root)).toBe('list-item');
    }
    flushDirtySlots();
    const eventNames = addEvent.mock.calls.map((c) => c[2]);
    expect(eventNames).toContain('tap');
    expect(eventNames).toContain('longpress');
  });
});
