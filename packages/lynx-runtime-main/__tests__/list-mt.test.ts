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

describe('list-mt keyed reorders', () => {
  /**
   * Set up list internalId=1 with one `<list-item>` per key (internal ids
   * 2, 3, …) and flush, committing the initial order. Returns key → id.
   */
  function setupList(keys: string[]): Map<string, number> {
    const listEl = createListElement(1);
    elements.set(1, listEl as never);
    const ids = new Map<string, number>();
    keys.forEach((key, i) => {
      const id = 2 + i;
      elements.set(id, fakeEl() as never);
      listInsertChild(1, id, -1);
      noteListItemProp(id, 'item-key', key);
      ids.set(key, id);
    });
    flushDirtyLists();
    return ids;
  }

  /**
   * Apply an `update-list-info` diff the way the native recycler does:
   * removeAction (ascending OLD indices) first, then insertAction (ascending
   * NEW positions). Asserts every insert position is within bounds.
   */
  function applyDiff(oldKeys: string[], info: any): string[] {
    const removed = new Set<number>(info.removeAction);
    const out = oldKeys.filter((_, i) => !removed.has(i));
    for (const ins of info.insertAction) {
      expect(ins.position).toBeLessThanOrEqual(out.length);
      out.splice(ins.position, 0, ins['item-key']);
    }
    return out;
  }

  it('move: re-inserting an existing child does not duplicate it and the diff transforms old → new', () => {
    const ids = setupList(['a', 'b', 'c']);
    // BG moves c before a: the shadow tree detaches implicitly, so the MT
    // sees ONLY an insert op for the already-present child.
    listInsertChild(1, ids.get('c')!, ids.get('a')!);
    flushDirtyLists();

    const info = lastUpdateListInfo();
    const applied = applyDiff(['a', 'b', 'c'], info);
    expect(applied).toEqual(['c', 'a', 'b']);
    expect(new Set(applied).size).toBe(applied.length); // no duplicate keys
    // The moved item's insertAction must carry its platform info.
    expect(info.insertAction).toEqual([
      { position: 0, type: 'list-item', 'item-key': 'c' },
    ]);
    expect(info.removeAction).toEqual([2]);
  });

  it('combined move+insert+remove yields exactly the new key sequence', () => {
    const ids = setupList(['a', 'b', 'c', 'd']);
    // New render: [e, c, a] — b and d unmount, c moves, e mounts.
    listRemoveChild(1, ids.get('b')!);
    listRemoveChild(1, ids.get('d')!);
    listInsertChild(1, ids.get('c')!, ids.get('a')!); // move c before a
    const e = 6;
    elements.set(e, fakeEl() as never);
    listInsertChild(1, e, ids.get('c')!); // mount e before c
    noteListItemProp(e, 'item-key', 'e');
    flushDirtyLists();

    const applied = applyDiff(['a', 'b', 'c', 'd'], lastUpdateListInfo());
    expect(applied).toEqual(['e', 'c', 'a']);
    expect(new Set(applied).size).toBe(applied.length);
  });

  it('repeated reorders across flushes keep committed state in sync', () => {
    const ids = setupList(['a', 'b', 'c']);
    listInsertChild(1, ids.get('c')!, ids.get('a')!); // → [c, a, b]
    flushDirtyLists();
    let native = applyDiff(['a', 'b', 'c'], lastUpdateListInfo());
    expect(native).toEqual(['c', 'a', 'b']);

    listInsertChild(1, ids.get('b')!, ids.get('c')!); // → [b, c, a]
    flushDirtyLists();
    native = applyDiff(native, lastUpdateListInfo());
    expect(native).toEqual(['b', 'c', 'a']);
    expect(new Set(native).size).toBe(native.length);
  });

  it('re-insert at the same position emits no diff', () => {
    const ids = setupList(['a', 'b']);
    const countBefore = setAttrCalls.filter((c) => c.key === 'update-list-info').length;
    listInsertChild(1, ids.get('a')!, ids.get('b')!); // a already before b
    flushDirtyLists();
    const countAfter = setAttrCalls.filter((c) => c.key === 'update-list-info').length;
    expect(countAfter).toBe(countBefore);
  });
});
