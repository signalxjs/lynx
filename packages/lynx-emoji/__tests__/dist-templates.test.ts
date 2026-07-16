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
  isSnapshotType,
  resetSnapshotRegistry,
  setSnapshotPageId,
  snapshotCreatorMap,
} from '@sigx/lynx-runtime-internal/snapshot';
import {
  createSnapshotInstance,
  installSnapshotMTHooks,
  resetSnapshotInstances,
} from '@sigx/lynx-runtime-main';

const DIST_CELL = new URL('../dist/components/EmojiCell.js', import.meta.url);

type FakeEl = { __id: number; tag: string };
let nextUid = 4000;

beforeEach(() => {
  resetSnapshotRegistry();
  resetSnapshotInstances();
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
  it.skipIf(!existsSync(DIST_CELL))('EmojiCell.js registers real-body templates that materialize', async () => {
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
