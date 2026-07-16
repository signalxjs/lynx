/**
 * #644 — precompiled dist registrations, runtime semantics.
 *
 * A package dist emitted by scripts/build-snapshot-dist.mjs registers each
 * template TWICE at module-eval time: the JS-target null-body lazy creator
 * first (part of the module code), then the appended LEPUS-target real-body
 * creator. This works because `snapshotCreatorMap` entries are lazy —
 * `getSnapshotDef` invokes the creator on first USE (instantiation at render
 * time), which is strictly after module eval, so the last write wins and
 * nothing can have materialized against the null-body def in between.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __pageId,
  createSnapshot,
  getSnapshotDef,
  resetSnapshotRegistry,
  setSnapshotPageId,
  snapshotCreatorMap,
} from '@sigx/lynx-runtime-internal/snapshot';
import { elements } from '../src/element-registry';
import {
  createSnapshotInstance,
  installSnapshotMTHooks,
  resetSnapshotInstances,
} from '../src/snapshot-mt';

type FakeEl = { __id: number; tag: string };
let nextUid = 3000;
let created = 0;

beforeEach(() => {
  resetSnapshotRegistry();
  resetSnapshotInstances();
  elements.clear();
  nextUid = 3000;
  created = 0;
  vi.stubGlobal('__CreateText', vi.fn(() => {
    created++;
    return { __id: nextUid++, tag: 'text' } as FakeEl;
  }));
  vi.stubGlobal('__SetCSSId', vi.fn());
  vi.stubGlobal('__SetAttribute', vi.fn());
  installSnapshotMTHooks();
  setSnapshotPageId(7);
});

const TPL = '__snapshot_dist_1';

function registerNullBody(): void {
  // JS-target module code's registration (create/update compiled out).
  snapshotCreatorMap[TPL] = (id) => createSnapshot(id, null, null, null, undefined, '__sigx__', null, true);
}

function registerRealBody(): void {
  // The appended LEPUS-target registration.
  snapshotCreatorMap[TPL] = (id) =>
    createSnapshot(
      id,
      function () {
        return [__CreateText(__pageId)] as unknown[];
      } as never,
      null,
      null,
      undefined,
      '__sigx__',
      null,
      true,
    );
}

describe('dist registration overwrite order', () => {
  it('real-body registration after null-body wins; instances materialize', () => {
    registerNullBody();
    registerRealBody();
    const inst = createSnapshotInstance(50, TPL);
    inst.ensureElements();
    expect(created).toBe(1);
    expect(inst.__elements).toHaveLength(1);
  });

  it('null-body alone (BG semantics) still registers the id, fails only on materialize', () => {
    registerNullBody();
    expect(getSnapshotDef(TPL)?.create).toBeNull();
    const inst = createSnapshotInstance(51, TPL);
    expect(() => inst.ensureElements()).toThrow(/no create/);
  });

  it('documents the caching boundary: a def resolved BEFORE the real-body write stays stale', () => {
    // This cannot happen for dist files (both writes are adjacent statements
    // in one module body; getSnapshotDef only runs at instantiation), but the
    // registry semantics are worth pinning: creator overwrites do not
    // invalidate an already-materialized def.
    registerNullBody();
    getSnapshotDef(TPL); // materializes the null-body def
    registerRealBody();
    expect(getSnapshotDef(TPL)?.create).toBeNull();
  });
});
