/**
 * Tests for the MT snapshot runtime (snapshot-mt.ts) and the shared
 * transform-contract module (@sigx/lynx-runtime-internal/snapshot).
 *
 * Templates are hand-authored in the exact shape the upstream transform
 * emits (a `snapshotCreatorMap[id] = (id) => createSnapshot(id, create,
 * updates, slots, …)` lazy registration whose `create` calls the element
 * PAPI directly); the PAPI globals are stubbed per the list-mt.test.ts
 * pattern.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __DynamicPartSlotV2,
  __pageId,
  createSnapshot,
  getSnapshotDef,
  isSnapshotType,
  resetSnapshotRegistry,
  setSnapshotPageId,
  snapshotCreateList,
  snapshotCreatorMap,
  updateEvent,
  updateListItemPlatformInfo,
  updateSpread,
  updateWorkletEvent,
  updateWorkletRef,
} from '@sigx/lynx-runtime-internal/snapshot';
import { elements } from '../src/element-registry';
import { flushDirtySlots, resetSlotStates } from '../src/event-slots';
import { isListElement, resetListState } from '../src/list-mt';
import { resetMtRefBindings, resolveElementIdByWvid } from '../src/mt-ref-bind';
import {
  createSnapshotInstance,
  destroySnapshotInstance,
  ensureSyntheticId,
  getSnapshotInstance,
  installSnapshotMTHooks,
  isSnapshotInstance,
  resetSnapshotInstances,
} from '../src/snapshot-mt';

type FakeEl = { __id: number; tag: string };
let nextUid = 5000;
function makeEl(tag: string): FakeEl {
  return { __id: nextUid++, tag };
}

let createViewCalls = 0;
let cssIdCalls: Array<{ els: FakeEl[]; id: number }> = [];
let setAttrCalls: Array<{ el: FakeEl; key: string; value: unknown }> = [];
let setStylesCalls: Array<{ el: FakeEl; styles: unknown }> = [];
let setClassesCalls: Array<{ el: FakeEl; classes: string }> = [];
let addEventCalls: Array<{ el: FakeEl; type: string; name: string; value: unknown }> = [];

beforeEach(() => {
  resetSnapshotRegistry();
  resetSnapshotInstances();
  resetSlotStates();
  resetListState();
  resetMtRefBindings();
  elements.clear();
  delete (globalThis as Record<string, unknown>)['lynxWorkletImpl'];
  nextUid = 5000;
  createViewCalls = 0;
  cssIdCalls = [];
  setAttrCalls = [];
  setStylesCalls = [];
  setClassesCalls = [];
  addEventCalls = [];

  vi.stubGlobal('__CreateView', vi.fn((_pid: number) => {
    createViewCalls++;
    return makeEl('view');
  }));
  vi.stubGlobal('__CreateText', vi.fn((_pid: number) => makeEl('text')));
  vi.stubGlobal('__CreateRawText', vi.fn((_text: string) => makeEl('raw-text')));
  vi.stubGlobal('__CreateElement', vi.fn((tag: string, _pid: number) => makeEl(tag)));
  vi.stubGlobal('__AppendElement', vi.fn());
  vi.stubGlobal('__SetCSSId', vi.fn((els: FakeEl[], id: number) => {
    cssIdCalls.push({ els, id });
  }));
  vi.stubGlobal('__SetAttribute', vi.fn((el: FakeEl, key: string, value: unknown) => {
    setAttrCalls.push({ el, key, value });
  }));
  vi.stubGlobal('__SetInlineStyles', vi.fn((el: FakeEl, styles: unknown) => {
    setStylesCalls.push({ el, styles });
  }));
  vi.stubGlobal('__SetClasses', vi.fn((el: FakeEl, classes: string) => {
    setClassesCalls.push({ el, classes });
  }));
  vi.stubGlobal('__SetID', vi.fn());
  vi.stubGlobal('__AddEvent', vi.fn((el: FakeEl, type: string, name: string, value: unknown) => {
    addEventCalls.push({ el, type, name, value });
  }));

  installSnapshotMTHooks();
  setSnapshotPageId(7);
});

/**
 * Register a two-element template in the transform's emitted shape:
 *   <view> <text hole:text /> </view>
 * holes: 0 = event on el0, 1 = text on el1 (raw inline updater).
 */
const CELL_ID = '__snapshot_test_1';
function registerCellTemplate(): void {
  snapshotCreatorMap[CELL_ID] = (id) =>
    createSnapshot(
      id,
      function (this: unknown) {
        const el0 = __CreateView(__pageId) as unknown as FakeEl;
        const el1 = __CreateText(__pageId) as unknown as FakeEl;
        __AppendElement(el0 as never, el1 as never);
        return [el0, el1] as unknown[];
      } as never,
      [
        (ctx, index, oldValue) => updateEvent(ctx, index, oldValue, 0, 'bindEvent', 'tap', ''),
        (ctx, index) => {
          if (ctx.__elements) {
            __SetAttribute(ctx.__elements[1] as never, 'text', ctx.__values[index]);
          }
        },
      ],
      [[__DynamicPartSlotV2, 1]],
      undefined,
      undefined,
      [0],
      true,
    );
}

describe('contract module registry', () => {
  it('resolves definitions lazily through snapshotCreatorMap', () => {
    registerCellTemplate();
    expect(isSnapshotType(CELL_ID)).toBe(true);
    expect(getSnapshotDef(CELL_ID)?.uniqID).toBe(CELL_ID);
    // Second resolution returns the cached def (creator ran once).
    expect(getSnapshotDef(CELL_ID)).toBe(getSnapshotDef(CELL_ID));
  });

  it('returns undefined for unknown template ids', () => {
    expect(getSnapshotDef('__snapshot_nope')).toBeUndefined();
    expect(isSnapshotType('__snapshot_nope')).toBe(false);
  });
});

describe('MTSnapshotInstance', () => {
  it('stays staged until ensureElements and replays staged values', () => {
    registerCellTemplate();
    const inst = createSnapshotInstance(11, CELL_ID);
    inst.setValues(['sign:1', 'hello']);
    expect(createViewCalls).toBe(0); // staged: no PAPI yet

    inst.ensureElements();
    expect(createViewCalls).toBe(1);
    expect(cssIdCalls[0]?.id).toBe(0);
    // Staged text hole replayed through update[1].
    expect(setAttrCalls.some((c) => c.key === 'text' && c.value === 'hello')).toBe(true);
    // Staged event hole replayed through the event-slot machinery.
    flushDirtySlots();
    expect(addEventCalls).toEqual([
      expect.objectContaining({ type: 'bindEvent', name: 'tap', value: 'sign:1' }),
    ]);
  });

  it('ensureElements is idempotent', () => {
    registerCellTemplate();
    const inst = createSnapshotInstance(12, CELL_ID);
    inst.ensureElements();
    inst.ensureElements();
    expect(createViewCalls).toBe(1);
  });

  it('patches live values through update[i], skipping identical ones', () => {
    registerCellTemplate();
    const inst = createSnapshotInstance(13, CELL_ID);
    inst.ensureElements();
    inst.setValue(1, 'a');
    inst.setValue(1, 'a'); // identical → skipped
    inst.setValue(1, 'b');
    const textWrites = setAttrCalls.filter((c) => c.key === 'text');
    expect(textWrites.map((c) => c.value)).toEqual(['a', 'b']);
  });

  it('setValues clears trailing stale holes on a shorter payload', () => {
    registerCellTemplate();
    const inst = createSnapshotInstance(17, CELL_ID);
    inst.ensureElements();
    inst.setValues(['sign:1', 'hello']);
    inst.setValues(['sign:1']); // shorter reuse payload
    expect(inst.__values).toHaveLength(1);
    // The text hole was patched to undefined (cleared), not left at 'hello'.
    const textWrites = setAttrCalls.filter((c) => c.key === 'text');
    expect(textWrites.map((c) => c.value)).toEqual(['hello', undefined]);
  });

  it('resolves slot elements by slot index', () => {
    registerCellTemplate();
    const inst = createSnapshotInstance(14, CELL_ID);
    const slotEl = inst.slotElement(0) as unknown as FakeEl;
    expect(slotEl.tag).toBe('text'); // def.slot[0] = [SlotV2, 1] → el1
    expect(inst.slotElement(3)).toBeNull();
  });

  it('throws on unknown templates and on background-target (null-create) defs', () => {
    expect(() => createSnapshotInstance(15, '__snapshot_missing')).toThrow(/unknown template/);
    createSnapshot('__snapshot_bg_only', null, null, null);
    const inst = createSnapshotInstance(16, '__snapshot_bg_only');
    expect(() => inst.ensureElements()).toThrow(/no create/);
  });
});

describe('synthetic ids', () => {
  it('mints negative ids, registers them in elements, and reuses per element', () => {
    registerCellTemplate();
    const inst = createSnapshotInstance(21, CELL_ID);
    const a = ensureSyntheticId(inst, 0);
    const b = ensureSyntheticId(inst, 1);
    expect(a).toBeLessThan(-1);
    expect(b).toBeLessThan(a);
    expect(ensureSyntheticId(inst, 0)).toBe(a);
    expect(elements.get(a)).toBe(inst.__elements?.[0]);
  });

  it('destroySnapshotInstance unregisters synthetic ids', () => {
    registerCellTemplate();
    const inst = createSnapshotInstance(22, CELL_ID);
    const synId = ensureSyntheticId(inst, 0);
    expect(isSnapshotInstance(22)).toBe(true);
    destroySnapshotInstance(22);
    expect(isSnapshotInstance(22)).toBe(false);
    expect(getSnapshotInstance(22)).toBeUndefined();
    expect(elements.has(synId)).toBe(false);
  });
});

describe('hole updaters', () => {
  it('combines a BG event hole and a worklet hole on one slot (hybrid path)', () => {
    registerCellTemplate();
    const inst = createSnapshotInstance(31, CELL_ID);
    inst.ensureElements();
    inst.__values[0] = 'sign:9';
    updateEvent(inst, 0, undefined, 0, 'bindEvent', 'tap', '');
    const worklet = { _wkltId: 'w:1' };
    inst.__values[2] = worklet;
    updateWorkletEvent(inst, 2, undefined, 0, 'main-thread', 'bindEvent', 'tap');
    flushDirtySlots();
    // One __AddEvent with a hybrid worklet ctx (both handlers present).
    expect(addEventCalls).toHaveLength(1);
    expect(addEventCalls[0].value).toMatchObject({ type: 'worklet' });
  });

  it('binds { __wvid } ref holes through bindMtRef', () => {
    registerCellTemplate();
    const inst = createSnapshotInstance(32, CELL_ID);
    inst.__values[0] = { __wvid: 42 };
    updateWorkletRef(inst, 0, undefined, 0);
    const synId = inst.syntheticIds.get(0);
    expect(resolveElementIdByWvid(42)).toBe(synId);
  });

  it('releases the previous binding when a ref hole is cleared or re-pointed', () => {
    registerCellTemplate();
    const inst = createSnapshotInstance(36, CELL_ID);
    inst.__values[0] = { __wvid: 50 };
    updateWorkletRef(inst, 0, undefined, 0);
    expect(resolveElementIdByWvid(50)).toBeDefined();

    inst.__values[0] = { __wvid: 51 }; // re-point
    updateWorkletRef(inst, 0, undefined, 0);
    expect(resolveElementIdByWvid(50)).toBeUndefined();
    expect(resolveElementIdByWvid(51)).toBeDefined();

    inst.__values[0] = null; // clear
    updateWorkletRef(inst, 0, undefined, 0);
    expect(resolveElementIdByWvid(51)).toBeUndefined();
  });

  it('nulls the upstream ref holder on release so worklets see "unbound"', () => {
    const refMap: Record<number, { current: unknown; _wvid: number }> = {};
    vi.stubGlobal('lynxWorkletImpl', {
      _refImpl: {
        _workletRefMap: refMap,
        updateWorkletRef: (refImpl: { _wvid: number }, el: unknown) => {
          refMap[refImpl._wvid].current = el;
        },
      },
    });
    registerCellTemplate();
    const inst = createSnapshotInstance(39, CELL_ID);
    inst.__values[0] = { __wvid: 70 };
    updateWorkletRef(inst, 0, undefined, 0);
    expect(refMap[70]?.current).not.toBeNull();
    inst.__values[0] = null;
    updateWorkletRef(inst, 0, undefined, 0);
    expect(refMap[70]?.current).toBeNull();
  });

  it('stamps worklet event holes with _workletType like the op path', () => {
    registerCellTemplate();
    const inst = createSnapshotInstance(37, CELL_ID);
    inst.ensureElements();
    const worklet: Record<string, unknown> = { _wkltId: 'w:2' };
    inst.__values[0] = worklet;
    updateWorkletEvent(inst, 0, undefined, 0, 'main-thread', 'bindEvent', 'tap');
    expect(worklet['_workletType']).toBe('main-thread');
  });

  it('destroy releases ref bindings and event-slot state for synthetic ids', () => {
    registerCellTemplate();
    const inst = createSnapshotInstance(38, CELL_ID);
    inst.__values[0] = { __wvid: 60 };
    updateWorkletRef(inst, 0, undefined, 0);
    inst.__values[1] = 'sign:x';
    updateEvent(inst, 1, undefined, 0, 'bindEvent', 'tap', '');
    destroySnapshotInstance(38);
    expect(resolveElementIdByWvid(60)).toBeUndefined();
    flushDirtySlots(); // pending dirty entry for the dead synthetic id
    expect(addEventCalls).toHaveLength(0);
  });

  it('routes spread entries to styles/classes/attrs/events and unsets removed keys', () => {
    registerCellTemplate();
    const inst = createSnapshotInstance(33, CELL_ID);
    inst.__values[0] = {
      style: { color: 'red' },
      class: 'chip',
      'data-x': 1,
      bindtap: 'sign:2',
    };
    updateSpread(inst, 0, undefined, 0);
    expect(setStylesCalls).toHaveLength(1);
    expect(setClassesCalls[0]?.classes).toBe('chip');
    expect(setAttrCalls.some((c) => c.key === 'data-x' && c.value === 1)).toBe(true);
    flushDirtySlots();
    expect(addEventCalls[0]?.value).toBe('sign:2');

    // Removing a key unsets it.
    const prev = inst.__values[0];
    inst.__values[0] = { class: 'chip' };
    updateSpread(inst, 0, prev, 0);
    expect(setStylesCalls[1]?.styles).toEqual({});
  });

  it('routes catch/global spread events by canonical type and rejects bindingx', () => {
    registerCellTemplate();
    const inst = createSnapshotInstance(41, CELL_ID);
    inst.__values[0] = {
      catchtap: 'sign:c',
      'global-bindexposure': 'sign:g',
      bindingx: 'not-an-event',
    };
    updateSpread(inst, 0, undefined, 0);
    flushDirtySlots();
    const types = addEventCalls.map((c) => `${c.type}:${c.name}`);
    expect(types).toContain('catchEvent:tap');
    expect(types).toContain('bindGlobalEvent:exposure');
    // bindingx is an attribute, never an event.
    expect(setAttrCalls.some((c) => c.key === 'bindingx')).toBe(true);
  });

  it('clears id with undefined, not an empty string', () => {
    const setIdCalls: unknown[] = [];
    vi.stubGlobal('__SetID', vi.fn((_el: FakeEl, v: unknown) => setIdCalls.push(v)));
    registerCellTemplate();
    const inst = createSnapshotInstance(42, CELL_ID);
    inst.__values[0] = { id: 'a' };
    updateSpread(inst, 0, undefined, 0);
    const prev = inst.__values[0];
    inst.__values[0] = { id: null };
    updateSpread(inst, 0, prev, 0);
    expect(setIdCalls).toEqual(['a', undefined]);
  });

  it('unsets platform-info keys that were removed', () => {
    registerCellTemplate();
    const inst = createSnapshotInstance(43, CELL_ID);
    inst.__values[0] = { 'item-key': 'k1', 'sticky-top': true };
    updateListItemPlatformInfo(inst, 0, undefined, 0);
    const prev = inst.__values[0];
    inst.__values[0] = { 'item-key': 'k1' };
    updateListItemPlatformInfo(inst, 0, prev, 0);
    const stickyWrites = setAttrCalls.filter((c) => c.key === 'sticky-top');
    expect(stickyWrites.map((c) => c.value)).toEqual([true, undefined]);
  });

  it('applies platform info as attributes minus virtual keys', () => {
    registerCellTemplate();
    const inst = createSnapshotInstance(34, CELL_ID);
    inst.__values[0] = {
      'item-key': 'k1',
      'estimated-main-axis-size-px': 44,
      'reuse-identifier': 'cell',
      recyclable: true,
    };
    updateListItemPlatformInfo(inst, 0, undefined, 0);
    const keys = setAttrCalls.map((c) => c.key);
    expect(keys).toContain('item-key');
    expect(keys).toContain('estimated-main-axis-size-px');
    expect(keys).not.toContain('reuse-identifier');
    expect(keys).not.toContain('recyclable');
  });

  it('snapshotCreateList creates a real recycler-registered list (list-mt state)', () => {
    const created: unknown[] = [];
    vi.stubGlobal('__CreateList', vi.fn((_pid: number, cai: unknown, eq: unknown) => {
      created.push([cai, eq]);
      return makeEl('list');
    }));
    vi.stubGlobal('__UpdateListCallbacks', vi.fn());
    vi.stubGlobal('__GetElementUniqueID', vi.fn((el: FakeEl) => el.__id));
    registerCellTemplate();
    const inst = createSnapshotInstance(35, CELL_ID);
    const el = snapshotCreateList(7, inst, 0) as FakeEl;
    expect(el.tag).toBe('list');
    expect(created).toHaveLength(1);
    expect(isListElement(35)).toBe(true); // state keyed by the instance's BG id
  });
});
