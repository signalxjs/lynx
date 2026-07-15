/**
 * Round-trip tests for the snapshot-granular ops (#628, phase 3 of #620):
 * hand-encoded flat op arrays → applyOps → fake-PAPI tree assertions.
 *
 * Key invariants:
 *  - snapshot ops are self-delimiting inside the flat interpreter (mixed
 *    element+snapshot batches can't desync)
 *  - SNAPSHOT_CREATE stages lazily (no PAPI until INSERT materializes)
 *  - snapshot roots and BIND_SLOT targets live in the shared `elements` map,
 *    so plain INSERT/REMOVE address template trees
 *  - REMOVE tears instances down (including bound slot ids)
 *  - the duplicate-batch guard accepts SNAPSHOT_CREATE-first batches
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OP } from '@sigx/lynx-runtime-internal';
import {
  __pageId,
  createSnapshot,
  resetSnapshotRegistry,
  setSnapshotPageId,
  snapshotCreatorMap,
} from '@sigx/lynx-runtime-internal/snapshot';
import { elements } from '../src/element-registry';
import { resetSlotStates } from '../src/event-slots';
import { applyOps, resetMainThreadState, setPlaceholder } from '../src/ops-apply';
import { isSnapshotInstance, resetSnapshotInstances } from '../src/snapshot-mt';

type FakeEl = { __id: number; tag: string; children: FakeEl[] };
let nextUid = 9000;
function makeEl(tag: string): FakeEl {
  return { __id: nextUid++, tag, children: [] };
}

let createViewCalls = 0;
let removedPairs: Array<[FakeEl, FakeEl]> = [];
let textWrites: Array<{ el: FakeEl; value: unknown }> = [];

beforeEach(() => {
  resetMainThreadState();
  resetSnapshotRegistry();
  resetSnapshotInstances();
  resetSlotStates();
  elements.clear();
  nextUid = 9000;
  createViewCalls = 0;
  removedPairs = [];
  textWrites = [];

  vi.stubGlobal('__CreateView', vi.fn(() => {
    createViewCalls++;
    return makeEl('view');
  }));
  vi.stubGlobal('__CreateText', vi.fn(() => makeEl('text')));
  vi.stubGlobal('__CreateRawText', vi.fn(() => makeEl('raw-text')));
  vi.stubGlobal('__CreateElement', vi.fn((tag: string) => makeEl(tag)));
  vi.stubGlobal('__CreatePage', vi.fn(() => makeEl('page')));
  vi.stubGlobal('__AppendElement', vi.fn((parent: FakeEl, child: FakeEl) => {
    parent.children.push(child);
  }));
  vi.stubGlobal('__InsertElementBefore', vi.fn((parent: FakeEl, child: FakeEl, anchor: FakeEl) => {
    const idx = parent.children.indexOf(anchor);
    parent.children.splice(idx === -1 ? parent.children.length : idx, 0, child);
  }));
  vi.stubGlobal('__RemoveElement', vi.fn((parent: FakeEl, child: FakeEl) => {
    parent.children = parent.children.filter((c) => c !== child);
    removedPairs.push([parent, child]);
  }));
  vi.stubGlobal('__SetCSSId', vi.fn());
  vi.stubGlobal('__SetAttribute', vi.fn((el: FakeEl, key: string, value: unknown) => {
    if (key === 'text') textWrites.push({ el, value });
  }));
  vi.stubGlobal('__SetInlineStyles', vi.fn());
  vi.stubGlobal('__SetClasses', vi.fn());
  vi.stubGlobal('__SetID', vi.fn());
  vi.stubGlobal('__AddEvent', vi.fn());
  vi.stubGlobal('__FlushElementTree', vi.fn());
  vi.stubGlobal('__GetElementUniqueID', vi.fn((el: FakeEl) => el.__id));

  setSnapshotPageId(7);

  // Page root (id 1), as renderPage would set up.
  const page = makeEl('page');
  elements.set(1, page as never);
  setPlaceholder(page as never, makeEl('placeholder') as never);
});

const TPL = '__snapshot_ops_1';
function registerTemplate(): void {
  snapshotCreatorMap[TPL] = (id) =>
    createSnapshot(
      id,
      function () {
        const el0 = __CreateView(__pageId) as unknown as FakeEl;
        const el1 = __CreateText(__pageId) as unknown as FakeEl;
        __AppendElement(el0 as never, el1 as never);
        return [el0, el1] as unknown[];
      } as never,
      [
        (ctx, index) => {
          if (ctx.__elements) {
            __SetAttribute(ctx.__elements[1] as never, 'text', ctx.__values[index]);
          }
        },
      ],
      [[6 /* SlotV2 */, 0]],
      undefined,
      undefined,
      null,
      true,
    );
}

describe('snapshot ops', () => {
  it('stages on SNAPSHOT_CREATE and materializes on INSERT', () => {
    registerTemplate();
    applyOps([OP.SNAPSHOT_CREATE, 10, TPL, OP.SNAPSHOT_SET_VALUES, 10, ['hi']]);
    expect(isSnapshotInstance(10)).toBe(true);
    expect(createViewCalls).toBe(0); // still staged

    applyOps([OP.INSERT, 1, 10, -1]);
    expect(createViewCalls).toBe(1);
    const page = elements.get(1) as unknown as FakeEl;
    expect(page.children.some((c) => c.tag === 'view')).toBe(true);
    expect(textWrites.map((w) => w.value)).toEqual(['hi']); // staged value replayed
  });

  it('patches holes via SNAPSHOT_SET_VALUE after materialization', () => {
    registerTemplate();
    applyOps([
      OP.SNAPSHOT_CREATE, 11, TPL,
      OP.SNAPSHOT_SET_VALUES, 11, ['a'],
      OP.INSERT, 1, 11, -1,
      OP.SNAPSHOT_SET_VALUE, 11, 0, 'b',
    ]);
    expect(textWrites.map((w) => w.value)).toEqual(['a', 'b']);
  });

  it('interleaves element ops and snapshot ops in one batch without desync', () => {
    registerTemplate();
    applyOps([
      OP.CREATE, 2, 'view',
      OP.INSERT, 1, 2, -1,
      OP.SNAPSHOT_CREATE, 12, TPL,
      OP.SNAPSHOT_SET_VALUES, 12, ['x'],
      OP.INSERT, 2, 12, -1,
      OP.SET_PROP, 2, 'data-k', 'v',
      OP.SNAPSHOT_SET_VALUE, 12, 0, 'y',
    ]);
    const host = elements.get(2) as unknown as FakeEl;
    expect(host.children).toHaveLength(1);
    expect(textWrites.map((w) => w.value)).toEqual(['x', 'y']);
  });

  it('BIND_SLOT registers the slot element so plain INSERTs land inside it', () => {
    registerTemplate();
    applyOps([
      OP.SNAPSHOT_CREATE, 13, TPL,
      OP.INSERT, 1, 13, -1,
      OP.SNAPSHOT_BIND_SLOT, 13, 0, 40, // slot 0 → elements[40] (= template el0)
      OP.CREATE, 41, 'view',
      OP.INSERT, 40, 41, -1, // ordinary INSERT into the bound slot
    ]);
    const root = elements.get(13) as unknown as FakeEl;
    expect(elements.get(40)).toBe(root as never);
    expect(root.children.some((c) => c.tag === 'view')).toBe(true);
  });

  it('REMOVE detaches the root and tears the instance (and slot ids) down', () => {
    registerTemplate();
    applyOps([
      OP.SNAPSHOT_CREATE, 14, TPL,
      OP.INSERT, 1, 14, -1,
      OP.SNAPSHOT_BIND_SLOT, 14, 0, 42,
      OP.REMOVE, 1, 14,
    ]);
    // removedPairs[0] is the renderPage placeholder (dropped on the first
    // batch); the last removal must be the instance root from the page.
    const [parent, child] = removedPairs[removedPairs.length - 1];
    expect(parent).toBe(elements.get(1));
    expect(child.tag).toBe('view');
    expect(isSnapshotInstance(14)).toBe(false);
    expect(elements.has(14)).toBe(false);
    expect(elements.has(42)).toBe(false);
  });

  it('drops duplicate SNAPSHOT_CREATE-first batches (double bundle eval)', () => {
    registerTemplate();
    const batch = [OP.SNAPSHOT_CREATE, 15, TPL, OP.SNAPSHOT_SET_VALUES, 15, ['once'], OP.INSERT, 1, 15, -1];
    applyOps(batch);
    expect(createViewCalls).toBe(1);
    applyOps(batch); // duplicate — must be skipped entirely
    expect(createViewCalls).toBe(1);
    expect(textWrites.map((w) => w.value)).toEqual(['once']);
  });

  it('an unknown template id fails per-op without killing the batch', () => {
    registerTemplate();
    applyOps([
      OP.SNAPSHOT_CREATE, 16, '__snapshot_unknown',
      OP.CREATE, 3, 'view',
      OP.INSERT, 1, 3, -1,
    ]);
    expect(isSnapshotInstance(16)).toBe(false);
    expect((elements.get(1) as unknown as FakeEl).children.some((c) => c.tag === 'view')).toBe(true);
  });
});
