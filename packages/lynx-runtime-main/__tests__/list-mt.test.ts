/**
 * Tests for native `<list>` recycler support (list-mt.ts).
 *
 * The Lynx `<list>` is a managed recycler: native pulls cells via the
 * `componentAtIndex` callback registered through `__CreateList`, and learns
 * its cell set from the `update-list-info` attribute. We stub the PAPI
 * globals, drive the module, capture the registered `componentAtIndex`, and
 * assert the wire shape + that componentAtIndex resolves the right element.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { elements } from '../src/element-registry';
import {
  createListElement,
  flushDirtyLists,
  isListElement,
  listInsertChild,
  listRemoveChild,
  noteListItemProp,
  resetListState,
} from '../src/list-mt';

// Fake MainThreadElement carrying a stable unique id.
type FakeEl = { __id: number };
let nextUid = 1000;
function fakeEl(): FakeEl {
  return { __id: nextUid++ };
}

let capturedComponentAtIndex:
  | ((list: unknown, listID: number, cellIndex: number, operationID: number, reuse: boolean) => number)
  | undefined;
let setAttrCalls: Array<{ key: string; value: any }> = [];
let appendCalls: Array<{ parent: FakeEl; child: FakeEl }> = [];

beforeEach(() => {
  resetListState();
  elements.clear();
  nextUid = 1000;
  capturedComponentAtIndex = undefined;
  setAttrCalls = [];
  appendCalls = [];

  vi.stubGlobal('__CreateList', vi.fn((_pid: number, componentAtIndex: any) => {
    capturedComponentAtIndex = componentAtIndex;
    return fakeEl();
  }));
  vi.stubGlobal('__GetElementUniqueID', vi.fn((el: FakeEl) => el.__id));
  vi.stubGlobal('__AppendElement', vi.fn((parent: FakeEl, child: FakeEl) => {
    appendCalls.push({ parent, child });
  }));
  vi.stubGlobal('__RemoveElement', vi.fn());
  vi.stubGlobal('__SetAttribute', vi.fn((_el: FakeEl, key: string, value: unknown) => {
    setAttrCalls.push({ key, value });
  }));
  vi.stubGlobal('__UpdateListCallbacks', vi.fn());
  vi.stubGlobal('__FlushElementTree', vi.fn());
});

function lastUpdateListInfo(): any {
  const hit = [...setAttrCalls].reverse().find((c) => c.key === 'update-list-info');
  return hit?.value;
}

describe('list-mt', () => {
  it('creates a list via __CreateList and tracks it', () => {
    const listEl = createListElement(1);
    elements.set(1, listEl as never);
    expect(isListElement(1)).toBe(true);
    expect(isListElement(2)).toBe(false);
    expect(__CreateList).toHaveBeenCalledOnce();
  });

  it('emits an initial insertAction for all items with their item-keys', () => {
    const listEl = createListElement(1);
    elements.set(1, listEl as never);
    // two list-item children
    const a = fakeEl(); const b = fakeEl();
    elements.set(2, a as never);
    elements.set(3, b as never);
    listInsertChild(1, 2, -1);
    noteListItemProp(2, 'item-key', 'row-a');
    listInsertChild(1, 3, -1);
    noteListItemProp(3, 'item-key', 'row-b');

    flushDirtyLists();

    const info = lastUpdateListInfo();
    expect(info).toBeDefined();
    expect(info.removeAction).toEqual([]);
    expect(info.insertAction).toEqual([
      { position: 0, type: 'list-item', 'item-key': 'row-a' },
      { position: 1, type: 'list-item', 'item-key': 'row-b' },
    ]);
  });

  it('componentAtIndex returns the pre-existing element sign and appends once', () => {
    const listEl = createListElement(1) as unknown as FakeEl;
    elements.set(1, listEl as never);
    const a = fakeEl();
    elements.set(2, a as never);
    listInsertChild(1, 2, -1);
    noteListItemProp(2, 'item-key', 'row-a');
    flushDirtyLists();

    const listID = listEl.__id;
    const sign = capturedComponentAtIndex!(listEl, listID, 0, 42, false);
    expect(sign).toBe(a.__id);
    expect(appendCalls).toEqual([{ parent: listEl, child: a }]);

    // Second pull for the same cell must NOT double-append.
    const sign2 = capturedComponentAtIndex!(listEl, listID, 0, 43, false);
    expect(sign2).toBe(a.__id);
    expect(appendCalls).toHaveLength(1);
  });

  it('incremental diff: append emits only the new item', () => {
    const listEl = createListElement(1);
    elements.set(1, listEl as never);
    const a = fakeEl(); elements.set(2, a as never);
    listInsertChild(1, 2, -1);
    noteListItemProp(2, 'item-key', 'a');
    flushDirtyLists();

    // add a second item
    const b = fakeEl(); elements.set(3, b as never);
    listInsertChild(1, 3, -1);
    noteListItemProp(3, 'item-key', 'b');
    flushDirtyLists();

    const info = lastUpdateListInfo();
    expect(info.removeAction).toEqual([]);
    expect(info.insertAction).toEqual([
      { position: 1, type: 'list-item', 'item-key': 'b' },
    ]);
  });

  it('incremental diff: removal emits the old index', () => {
    const listEl = createListElement(1);
    elements.set(1, listEl as never);
    const a = fakeEl(); elements.set(2, a as never);
    const b = fakeEl(); elements.set(3, b as never);
    listInsertChild(1, 2, -1); noteListItemProp(2, 'item-key', 'a');
    listInsertChild(1, 3, -1); noteListItemProp(3, 'item-key', 'b');
    flushDirtyLists();

    listRemoveChild(1, 2); // remove first item
    flushDirtyLists();

    const info = lastUpdateListInfo();
    expect(info.removeAction).toEqual([0]);
    expect(info.insertAction).toEqual([]);
  });

  it('does not re-emit update-list-info when nothing changed', () => {
    const listEl = createListElement(1);
    elements.set(1, listEl as never);
    const a = fakeEl(); elements.set(2, a as never);
    listInsertChild(1, 2, -1); noteListItemProp(2, 'item-key', 'a');
    flushDirtyLists();
    const countAfterFirst = setAttrCalls.filter((c) => c.key === 'update-list-info').length;
    flushDirtyLists(); // nothing changed
    const countAfterSecond = setAttrCalls.filter((c) => c.key === 'update-list-info').length;
    expect(countAfterSecond).toBe(countAfterFirst);
  });
});
