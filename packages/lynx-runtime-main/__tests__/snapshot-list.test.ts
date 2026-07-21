/**
 * List-template integration tests (#639, phase 5 of #620): a compiled
 * `<list>` template + `<list-item>` templates driven through `applyOps`
 * against fake PAPI, exercising the full lifecycle — staged rows as the
 * update-list-info manifest, synchronous `componentAtIndex` materialization,
 * scroll-back stability, template-keyed recycling with hole re-patch, keyed
 * reorders, and teardown.
 *
 * Templates are hand-authored in the transform's emitted shape (verified by
 * probe: `<list>` create calls `snapshotCreateList` with a ListSlotV2 slot;
 * `<list-item>` platform attributes hoist into hole 0 with
 * `updateListItemPlatformInfo(…, 0)` as update[0]).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OP } from '@sigx/lynx-runtime-internal';
import {
  __DynamicPartListSlotV2,
  __DynamicPartSlotV2,
  __pageId,
  createSnapshot,
  resetSnapshotRegistry,
  setSnapshotPageId,
  snapshotCreateList,
  snapshotCreatorMap,
  updateEvent,
  updateListItemPlatformInfo,
} from '@sigx/lynx-runtime-internal/snapshot';
import { elements } from '../src/element-registry';
import { publishEvent, register, resetRegistry } from '../../lynx-runtime/src/event-registry';
import { resetSlotStates } from '../src/event-slots';
import { flushDirtyLists, isListElement, resetListState } from '../src/list-mt';
import { resetMtRefBindings } from '../src/mt-ref-bind';
import { applyOps, resetMainThreadState, setPlaceholder } from '../src/ops-apply';
import {
  getSnapshotInstance,
  installSnapshotMTHooks,
  isSnapshotInstance,
  resetSnapshotInstances,
} from '../src/snapshot-mt';

type FakeEl = { __id: number; tag: string; children: FakeEl[]; attrs: Record<string, unknown> };
let nextUid = 7000;
function makeEl(tag: string): FakeEl {
  return { __id: nextUid++, tag, children: [], attrs: {} };
}

let capturedCAI:
  | ((list: unknown, listID: number, cellIndex: number, operationID: number, reuse: boolean) => number)
  | undefined;
let capturedEnqueue: ((list: unknown, listID: number, sign: number) => void) | undefined;
let listEl: FakeEl | undefined;
let cellFlushes: Array<Record<string, unknown>> = [];
let createdCells = 0;
let addEventCalls: Array<{ el: FakeEl; value: unknown }> = [];

beforeEach(() => {
  resetMainThreadState();
  resetSnapshotRegistry();
  resetSnapshotInstances();
  resetSlotStates();
  resetListState();
  resetMtRefBindings();
  resetRegistry();
  elements.clear();
  nextUid = 7000;
  capturedCAI = undefined;
  capturedEnqueue = undefined;
  listEl = undefined;
  cellFlushes = [];
  createdCells = 0;
  addEventCalls = [];

  vi.stubGlobal('__CreateView', vi.fn(() => makeEl('view')));
  vi.stubGlobal('__CreateText', vi.fn(() => makeEl('text')));
  vi.stubGlobal('__CreateRawText', vi.fn(() => makeEl('raw-text')));
  vi.stubGlobal('__CreateElement', vi.fn((tag: string) => {
    if (tag === 'list-item') createdCells++;
    return makeEl(tag);
  }));
  vi.stubGlobal('__CreatePage', vi.fn(() => makeEl('page')));
  vi.stubGlobal('__CreateList', vi.fn((_pid: number, cai: never, eq: never) => {
    capturedCAI = cai;
    capturedEnqueue = eq;
    listEl = makeEl('list');
    return listEl;
  }));
  vi.stubGlobal('__UpdateListCallbacks', vi.fn((_el: FakeEl, cai: never, eq: never) => {
    if (cai) capturedCAI = cai;
    if (eq) capturedEnqueue = eq;
  }));
  vi.stubGlobal('__AppendElement', vi.fn((parent: FakeEl, child: FakeEl) => {
    parent.children.push(child);
  }));
  vi.stubGlobal('__InsertElementBefore', vi.fn((parent: FakeEl, child: FakeEl, anchor: FakeEl) => {
    const idx = parent.children.indexOf(anchor);
    parent.children.splice(idx === -1 ? parent.children.length : idx, 0, child);
  }));
  vi.stubGlobal('__RemoveElement', vi.fn((parent: FakeEl, child: FakeEl) => {
    parent.children = parent.children.filter((c) => c !== child);
  }));
  vi.stubGlobal('__SetCSSId', vi.fn());
  vi.stubGlobal('__SetAttribute', vi.fn((el: FakeEl, key: string, value: unknown) => {
    el.attrs[key] = value;
  }));
  vi.stubGlobal('__SetInlineStyles', vi.fn());
  vi.stubGlobal('__SetClasses', vi.fn());
  vi.stubGlobal('__SetID', vi.fn());
  vi.stubGlobal('__AddEvent', vi.fn((el: FakeEl, _t: string, _n: string, value: unknown) => {
    addEventCalls.push({ el, value });
  }));
  vi.stubGlobal('__GetElementUniqueID', vi.fn((el: FakeEl) => el.__id));
  vi.stubGlobal('__FlushElementTree', vi.fn((_el?: FakeEl, opts?: Record<string, unknown>) => {
    if (opts) cellFlushes.push(opts);
  }));

  installSnapshotMTHooks();
  setSnapshotPageId(7);
  const page = makeEl('page');
  elements.set(1, page as never);
  setPlaceholder(page as never, makeEl('placeholder') as never);
  registerTemplates();
});

const LIST_TPL = '__snapshot_list_tpl_1';
const ITEM_TPL = '__snapshot_list_tpl_2';

/** Transform-shaped registrations (probe-verified shapes). */
function registerTemplates(): void {
  snapshotCreatorMap[LIST_TPL] = (id) =>
    createSnapshot(
      id,
      function (snapshotInstance: unknown) {
        const el = snapshotCreateList(__pageId, snapshotInstance as never, 0);
        __SetAttribute(el as never, 'list-type', 'single');
        return [el];
      } as never,
      null,
      [[__DynamicPartListSlotV2, 0]],
      undefined,
      undefined,
      null,
      true,
    );
  snapshotCreatorMap[ITEM_TPL] = (id) =>
    createSnapshot(
      id,
      function () {
        const el = __CreateElement('list-item', __pageId) as unknown as FakeEl;
        const el1 = __CreateText(__pageId) as unknown as FakeEl;
        __AppendElement(el as never, el1 as never);
        return [el, el1] as unknown[];
      } as never,
      [
        (ctx, index, oldValue) => updateListItemPlatformInfo(ctx, index, oldValue, 0),
        (ctx, index) => {
          if (ctx.__elements) {
            __SetAttribute(ctx.__elements[1] as never, 'text', ctx.__values[index]);
          }
        },
        (ctx, index, oldValue) => updateEvent(ctx, index, oldValue, 0, 'bindEvent', 'tap', ''),
      ],
      [[__DynamicPartSlotV2, 1]],
      undefined,
      undefined,
      null,
      true,
    );
}

/**
 * Mount a list with rows [(key, label, sign?)] the way the BG emits it:
 * list create + insert into page + slot bind, then per row create +
 * set_values + insert into the slot alias.
 */
const LIST_ID = 10;
const SLOT_ID = 11;
function mountList(rows: Array<[string, string, string?]>, firstRowId = 100): void {
  const ops: unknown[] = [
    OP.SNAPSHOT_CREATE, LIST_ID, LIST_TPL,
    OP.INSERT, 1, LIST_ID, -1,
    OP.SNAPSHOT_BIND_SLOT, LIST_ID, 0, SLOT_ID,
  ];
  rows.forEach(([key, label, sign], i) => {
    const id = firstRowId + i;
    ops.push(
      OP.SNAPSHOT_CREATE, id, ITEM_TPL,
      OP.SNAPSHOT_SET_VALUES, id, [{ 'item-key': key }, label, ...(sign ? [sign] : [])],
      OP.INSERT, SLOT_ID, id, -1,
    );
  });
  applyOps(ops);
  flushDirtyLists();
}

function lastListInfo(): { insertAction: Array<Record<string, unknown>>; removeAction: number[] } {
  return listEl!.attrs['update-list-info'] as never;
}

describe('list templates', () => {
  it('publishes the staged-row manifest with platform info before any cell is built', () => {
    mountList([['a', 'Alpha'], ['b', 'Beta'], ['c', 'Gamma']]);
    expect(isListElement(LIST_ID)).toBe(true);
    expect(createdCells).toBe(0); // nothing materialized
    const info = lastListInfo();
    expect(info.insertAction.map((a) => a['item-key'])).toEqual(['a', 'b', 'c']);
    expect(info.insertAction.map((a) => a['position'])).toEqual([0, 1, 2]);
    expect(info.removeAction).toEqual([]);
  });

  it('componentAtIndex materializes synchronously, returns a sign, and flushes the cell', () => {
    mountList([['a', 'Alpha'], ['b', 'Beta']]);
    const sign = capturedCAI!(listEl, listEl!.__id, 0, 555, false);
    expect(sign).toBeGreaterThan(0);
    expect(createdCells).toBe(1); // only the pulled row
    const inst = getSnapshotInstance(100)!;
    expect(inst.__elements).not.toBeNull();
    expect((inst.__elements![1] as unknown as FakeEl).attrs['text']).toBe('Alpha');
    expect(listEl!.children).toHaveLength(1);
    expect(cellFlushes.at(-1)).toMatchObject({ operationID: 555, elementID: sign });
  });

  it('scroll-back re-pull returns the same sign without rebuilding', () => {
    mountList([['a', 'Alpha']]);
    const s1 = capturedCAI!(listEl, listEl!.__id, 0, 1, false);
    const s2 = capturedCAI!(listEl, listEl!.__id, 0, 2, false);
    expect(s2).toBe(s1);
    expect(createdCells).toBe(1);
    expect(listEl!.children).toHaveLength(1); // no double append
  });

  it('enqueue → pull of a different row adopts the pooled tree and re-patches holes', () => {
    const handlers: Record<string, () => void> = {};
    let fired = '';
    const signA = register(() => { fired = 'a'; });
    const signB = register(() => { fired = 'b'; });
    handlers[signA] = () => {};
    handlers[signB] = () => {};
    mountList([['a', 'Alpha', signA], ['b', 'Beta', signB]]);

    const s1 = capturedCAI!(listEl, listEl!.__id, 0, 1, false);
    expect(createdCells).toBe(1);
    const cellRoot = getSnapshotInstance(100)!.__elements![0] as unknown as FakeEl;

    capturedEnqueue!(listEl, listEl!.__id, s1);
    expect(getSnapshotInstance(100)!.__elements).toBeNull(); // reverted to staged
    expect(listEl!.children).toHaveLength(0);

    const s2 = capturedCAI!(listEl, listEl!.__id, 1, 2, false);
    expect(createdCells).toBe(1); // ADOPTED, not constructed
    const inst2 = getSnapshotInstance(101)!;
    expect(inst2.__elements![0]).toBe(cellRoot as never); // same recycled tree
    expect((inst2.__elements![1] as unknown as FakeEl).attrs['text']).toBe('Beta'); // re-patched
    expect((inst2.__elements![0] as unknown as FakeEl).attrs['item-key']).toBe('b');
    expect(s2).toBe(s1); // same native element, same sign
    // Event slot re-signed to row b's handler.
    const lastEvent = addEventCalls.at(-1);
    expect(lastEvent?.value).toBe(signB);
    publishEvent(lastEvent?.value as string, {});
    expect(fired).toBe('b');
  });

  it('keyed reorder emits minimal insert/remove actions over instance ids', () => {
    mountList([['a', 'Alpha'], ['b', 'Beta'], ['c', 'Gamma']]);
    // Move row c (102) to the front: BG emits a bare INSERT with anchor 100.
    applyOps([OP.INSERT, SLOT_ID, 102, 100]);
    flushDirtyLists();
    const info = lastListInfo();
    // One remove (old index 2) + one insert at position 0 — the LIS backbone
    // (a, b) stays put.
    expect(info.removeAction).toEqual([2]);
    expect(info.insertAction).toHaveLength(1);
    expect(info.insertAction[0]).toMatchObject({ position: 0, 'item-key': 'c' });
  });

  it('row removal destroys live instances; list teardown clears pools and aliases', () => {
    mountList([['a', 'Alpha'], ['b', 'Beta']]);
    const s1 = capturedCAI!(listEl, listEl!.__id, 0, 1, false);
    capturedEnqueue!(listEl, listEl!.__id, s1); // row a's tree → pool
    applyOps([OP.REMOVE, SLOT_ID, 100]); // remove pooled-away row: instance dies, pool survives
    expect(isSnapshotInstance(100)).toBe(false);

    // The pooled tree is still adoptable by row b.
    const s2 = capturedCAI!(listEl, listEl!.__id, 0, 2, false);
    expect(createdCells).toBe(1);
    expect(s2).toBe(s1);

    // Tear the whole list down: aliases and instances go with it.
    applyOps([OP.REMOVE, 1, LIST_ID]);
    expect(isListElement(LIST_ID)).toBe(false);
    expect(isListElement(SLOT_ID)).toBe(false);
    expect(isSnapshotInstance(101)).toBe(false);
  });

  it('pulling an out-of-range or unknown row returns -1', () => {
    mountList([['a', 'Alpha']]);
    expect(capturedCAI!(listEl, listEl!.__id, 5, 1, false)).toBe(-1);
    expect(capturedCAI!(listEl, 424242, 0, 1, false)).toBe(-1);
  });
});

describe('slot-bearing cells', () => {
  it('keeps the tree materialized across enqueue (no pool, aliases intact)', () => {
    // BG emits SNAPSHOT_BIND_SLOT once — dropping the alias on recycle would
    // orphan every future slot-content op. Slot-bearing cells behave like
    // eager cells: dedicated tree, native detaches the view, next pull
    // re-surfaces the same tree by sign.
    mountList([['a', 'Alpha'], ['b', 'Beta']]);
    const sign0 = capturedCAI!(listEl, listEl!.__id, 0, 1, false);
    expect(sign0).toBeGreaterThan(0);
    // Simulate a bound slot on the materialized instance (row id 100).
    const inst = getSnapshotInstance(100)!;
    inst.slotElIds.add(-99);
    elements.set(-99, inst.__elements![0] as never);
    const builtBefore = createdCells;

    capturedEnqueue!(listEl, listEl!.__id, sign0);
    expect(elements.has(-99)).toBe(true); // alias intact for future slot ops
    expect(inst.__elements).not.toBeNull(); // still materialized
    expect(elements.has(100)).toBe(true); // root still registered

    // Scroll-back re-surfaces the SAME tree — same sign, nothing rebuilt.
    const sign1 = capturedCAI!(listEl, listEl!.__id, 0, 2, false);
    expect(sign1).toBe(sign0);
    expect(createdCells).toBe(builtBefore);
  });
});

describe('bound-cell removal defers teardown until native release (core#275)', () => {
  // Native learns about removals only from the update-list-info diff, and
  // reconciling it touches the outgoing cell (RecycleRemovedItemHolders →
  // SendExposureEvent). Destroying a BOUND cell at REMOVE-op time frees the
  // element under native's feet — the SIGSEGV typing into a list-filtering
  // search box (showcase Home) — and merely DETACHING it early refaults at
  // the same native frames. Bound cells must stay fully wired (attached,
  // registered, sign-mapped) as zombies until enqueueComponent releases them.

  it('mass removal keeps bound cells fully wired until enqueue, then pools their trees', () => {
    mountList([['a', 'Alpha'], ['b', 'Beta'], ['c', 'Gamma']]);
    const s0 = capturedCAI!(listEl, listEl!.__id, 0, 1, false);
    const s1 = capturedCAI!(listEl, listEl!.__id, 1, 2, false);
    expect(createdCells).toBe(2);

    // The filter clears every row in one batch; row c (102) was never pulled.
    applyOps([
      OP.REMOVE, SLOT_ID, 100,
      OP.REMOVE, SLOT_ID, 101,
      OP.REMOVE, SLOT_ID, 102,
    ]);
    flushDirtyLists();

    // Staged row: native never saw it — destroyed immediately.
    expect(isSnapshotInstance(102)).toBe(false);
    // Bound rows: STILL fully wired — attached to the list element, with
    // instances and registry entries alive for native's reconciliation.
    expect(listEl!.children).toHaveLength(2);
    expect(isSnapshotInstance(100)).toBe(true);
    expect(isSnapshotInstance(101)).toBe(true);
    expect(elements.has(100)).toBe(true);
    expect(elements.has(101)).toBe(true);
    expect(getSnapshotInstance(100)!.__elements).not.toBeNull();
    // The diff still reports all three rows gone.
    expect(lastListInfo().removeAction).toEqual([0, 1, 2]);
    expect(lastListInfo().insertAction).toEqual([]);

    // Native reconciles and releases the holders — NOW teardown runs.
    capturedEnqueue!(listEl, listEl!.__id, s0);
    capturedEnqueue!(listEl, listEl!.__id, s1);
    expect(isSnapshotInstance(100)).toBe(false);
    expect(isSnapshotInstance(101)).toBe(false);
    expect(elements.has(100)).toBe(false);
    expect(elements.has(101)).toBe(false);
    expect(listEl!.children).toHaveLength(0);

    // The released trees are recyclable: a new row adopts one instead of
    // constructing.
    applyOps([
      OP.SNAPSHOT_CREATE, 200, ITEM_TPL,
      OP.SNAPSHOT_SET_VALUES, 200, [{ 'item-key': 'd' }, 'Delta'],
      OP.INSERT, SLOT_ID, 200, -1,
    ]);
    flushDirtyLists();
    const s2 = capturedCAI!(listEl, listEl!.__id, 0, 3, false);
    expect(createdCells).toBe(2); // adopted, not constructed
    expect([s0, s1]).toContain(s2);
    const inst = getSnapshotInstance(200)!;
    expect((inst.__elements![1] as unknown as FakeEl).attrs['text']).toBe('Delta');
  });

  it('a zombie re-inserted before native releases it comes back to life', () => {
    mountList([['a', 'Alpha'], ['b', 'Beta']]);
    const s0 = capturedCAI!(listEl, listEl!.__id, 0, 1, false);

    applyOps([OP.REMOVE, SLOT_ID, 100]);
    flushDirtyLists();
    expect(isSnapshotInstance(100)).toBe(true); // zombie: bound at removal

    // BG re-inserts the same instance before any enqueue arrives.
    applyOps([OP.INSERT, SLOT_ID, 100, 101]);
    flushDirtyLists();

    // Fully live again: the pull re-attaches the SAME tree — same sign,
    // nothing rebuilt.
    const sAgain = capturedCAI!(listEl, listEl!.__id, 0, 2, false);
    expect(sAgain).toBe(s0);
    expect(createdCells).toBe(1);
    expect(listEl!.children).toHaveLength(1);

    // A later enqueue is plain recycling, not zombie release: the instance
    // reverts to staged but survives.
    capturedEnqueue!(listEl, listEl!.__id, s0);
    expect(isSnapshotInstance(100)).toBe(true);
    expect(getSnapshotInstance(100)!.__elements).toBeNull();
  });

  it('a slot-bearing zombie is destroyed on release, not pooled', () => {
    mountList([['a', 'Alpha'], ['b', 'Beta']]);
    const s0 = capturedCAI!(listEl, listEl!.__id, 0, 1, false);
    const inst = getSnapshotInstance(100)!;
    inst.slotElIds.add(-99);
    elements.set(-99, inst.__elements![0] as never);

    applyOps([OP.REMOVE, SLOT_ID, 100]);
    flushDirtyLists();
    expect(isSnapshotInstance(100)).toBe(true); // zombie
    expect(elements.has(-99)).toBe(true); // slot alias still routable

    capturedEnqueue!(listEl, listEl!.__id, s0);
    expect(isSnapshotInstance(100)).toBe(false);
    expect(elements.has(-99)).toBe(false); // alias went down with it
    expect(listEl!.children).toHaveLength(0);
    // Its slot-bearing tree must NOT be adoptable by a fresh row.
    applyOps([
      OP.SNAPSHOT_CREATE, 201, ITEM_TPL,
      OP.SNAPSHOT_SET_VALUES, 201, [{ 'item-key': 'e' }, 'Echo'],
      OP.INSERT, SLOT_ID, 201, -1,
    ]);
    flushDirtyLists();
    capturedCAI!(listEl, listEl!.__id, 1, 2, false);
    expect(createdCells).toBe(2); // constructed fresh
  });

  it('list teardown with pending zombies cleans them and installs inert callbacks', () => {
    mountList([['a', 'Alpha'], ['b', 'Beta']]);
    capturedCAI!(listEl, listEl!.__id, 0, 1, false);
    applyOps([OP.REMOVE, SLOT_ID, 100]);
    flushDirtyLists();
    expect(isSnapshotInstance(100)).toBe(true); // zombie awaiting release

    const updateCallbacks = __UpdateListCallbacks as unknown as ReturnType<typeof vi.fn>;
    updateCallbacks.mockClear();
    applyOps([OP.REMOVE, 1, LIST_ID]);
    expect(isSnapshotInstance(100)).toBe(false);
    expect(isSnapshotInstance(101)).toBe(false);
    // Native may still invoke the recycler callbacks while the teardown
    // settles — they must be inert functions, never null.
    const [, cai, eq] = updateCallbacks.mock.calls[0] as [unknown, unknown, unknown];
    expect(typeof cai).toBe('function');
    expect(typeof eq).toBe('function');
    expect((cai as () => number)()).toBe(-1);
    expect((eq as () => void)()).toBeUndefined();
  });
});

describe('non-list-item root DEV guard (#645)', () => {
  const BAD_TPL = '__snapshot_bad_root_1';
  function registerBadTemplate(): void {
    snapshotCreatorMap[BAD_TPL] = (id) =>
      createSnapshot(
        id,
        function () {
          const el = __CreateView(__pageId) as unknown as FakeEl; // wrong root
          return [el];
        } as never,
        [(ctx, index, oldValue) => updateListItemPlatformInfo(ctx, index, oldValue, 0)],
        null,
        undefined,
        undefined,
        null,
        true,
      );
  }

  it('warns once per template type when a cell root is not <list-item>', () => {
    vi.stubGlobal('__GetTag', vi.fn((el: FakeEl) => el.tag));
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.join(' '));
    });
    registerBadTemplate();
    applyOps([
      OP.SNAPSHOT_CREATE, LIST_ID, LIST_TPL,
      OP.INSERT, 1, LIST_ID, -1,
      OP.SNAPSHOT_BIND_SLOT, LIST_ID, 0, SLOT_ID,
      OP.SNAPSHOT_CREATE, 400, BAD_TPL,
      OP.SNAPSHOT_SET_VALUES, 400, [{ 'item-key': 'x' }],
      OP.INSERT, SLOT_ID, 400, -1,
      OP.SNAPSHOT_CREATE, 401, BAD_TPL,
      OP.SNAPSHOT_SET_VALUES, 401, [{ 'item-key': 'y' }],
      OP.INSERT, SLOT_ID, 401, -1,
      OP.SNAPSHOT_CREATE, 402, ITEM_TPL,
      OP.SNAPSHOT_SET_VALUES, 402, [{ 'item-key': 'ok' }, 'fine'],
      OP.INSERT, SLOT_ID, 402, -1,
    ]);
    flushDirtyLists();
    capturedCAI!(listEl, listEl!.__id, 0, 1, false);
    capturedCAI!(listEl, listEl!.__id, 1, 2, false); // same bad template — no repeat
    capturedCAI!(listEl, listEl!.__id, 2, 3, false); // list-item root — silent
    const warns = logs.filter((l) => l.includes('not <list-item>'));
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(BAD_TPL);
    logSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
