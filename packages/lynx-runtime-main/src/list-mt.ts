/**
 * Main Thread native `<list>` recycler support.
 *
 * Lynx's `<list>` is NOT a plain scrolling container — it's a managed recycler.
 * Native pulls each visible cell by calling `componentAtIndex(cellIndex)` and
 * recycles offscreen cells via `enqueueComponent(sign)`. If its
 * `update-list-info` metadata is never set, native crashes during layout
 * (`UIList.onLayoutCompleted` NPE — issue #120).
 *
 * The reference framework (`@lynx-js/react`) renders each `<list-item>` subtree
 * on demand inside `componentAtIndex`. The sigx renderer is different: the
 * Background Thread eagerly creates ALL `<list-item>` elements (and their
 * subtrees) on the Main Thread, just like any other children. So here
 * `componentAtIndex` does not render anything — it simply returns the sign of
 * the already-built element for that index, appending it to the list on first
 * pull so native can find it via its unique id.
 *
 * What this module owns:
 *  - Creating `<list>` via `__CreateList` (so the callbacks are registered).
 *  - Tracking each list's ordered `<list-item>` children (BG insertion order)
 *    and their per-item platform info (item-key etc.).
 *  - Emitting `update-list-info` diffs (insert/remove actions) at the end of
 *    each ops batch so native knows how many cells exist and their keys.
 *
 * `<list-item>` children are intercepted here instead of being appended to the
 * list element directly (the recycler owns attachment via `componentAtIndex`).
 */

import { elements, pageUniqueId } from './element-registry.js';

/**
 * Per-`<list-item>` platform-info attribute keys (kebab-case). These are
 * forwarded to native both as element attributes (via the normal SET_PROP →
 * __SetAttribute path) and inside `update-list-info`'s insertAction entries.
 */
const PLATFORM_INFO_KEYS = new Set([
  'item-key',
  'full-span',
  'sticky-top',
  'sticky-bottom',
  'estimated-height',
  'estimated-height-px',
  'estimated-main-axis-size-px',
  'reuse-identifier',
  'recyclable',
]);

interface ListState {
  internalId: number;
  listEl: MainThreadElement;
  /** PAPI unique id of the list element (the `listID` native passes back). */
  listID: number;
  /** Ordered child internal ids, in Background-Thread insertion order. */
  order: number[];
  /** Order last published to native via `update-list-info` (for diffing). */
  committed: number[];
  /** Child internal ids currently appended to the list element. */
  appended: Set<number>;
  dirty: boolean;
}

const listsByInternalId = new Map<number, ListState>();
const listByListID = new Map<number, ListState>();
/** child internal id → owning list internal id */
const listItemOwner = new Map<number, number>();
/** child internal id → per-item platform info ({ 'item-key': … }) */
const itemPlatformInfo = new Map<number, Record<string, unknown>>();

/** True when `internalId` is a `<list>` element managed by this module. */
export function isListElement(internalId: number): boolean {
  return listsByInternalId.has(internalId);
}

/** True when `internalId` is a direct `<list-item>` child of some `<list>`. */
export function isListChild(internalId: number): boolean {
  return listItemOwner.has(internalId);
}

// ---------------------------------------------------------------------------
// Recycler callbacks (invoked by native during layout, on the Main Thread)
// ---------------------------------------------------------------------------

function componentAtIndex(
  _list: MainThreadElement,
  listID: number,
  cellIndex: number,
  operationID: number,
  _enableReuseNotification: boolean,
): number {
  const state = listByListID.get(listID);
  if (!state) return -1;
  const childInternalId = state.order[cellIndex];
  if (childInternalId === undefined) return -1;
  const root = elements.get(childInternalId);
  if (!root) return -1;
  const sign = __GetElementUniqueID(root);
  // The element already exists (BG built it eagerly). Append on first pull so
  // native can resolve it by sign; the guard prevents a double-append when the
  // cell scrolls back into view.
  if (!state.appended.has(childInternalId)) {
    __AppendElement(state.listEl, root);
    state.appended.add(childInternalId);
  }
  __FlushElementTree(root, {
    triggerLayout: true,
    operationID,
    elementID: sign,
    listID,
  });
  return sign;
}

function enqueueComponent(
  _list: MainThreadElement,
  _listID: number,
  _sign: number,
): void {
  // No-op. Each `<list-item>` has its own dedicated, already-rendered element,
  // so we never recycle one element's subtree to display a different item.
  // Native detaches the offscreen view on its own; the element stays in the
  // tree so `componentAtIndex` can re-surface it on scroll-back.
}

// ---------------------------------------------------------------------------
// Lifecycle, invoked from ops-apply.ts
// ---------------------------------------------------------------------------

/** Create a `<list>` element and register its recycler callbacks. */
export function createListElement(internalId: number): MainThreadElement {
  const listEl = __CreateList(pageUniqueId, componentAtIndex, enqueueComponent);
  const listID = __GetElementUniqueID(listEl);
  const state: ListState = {
    internalId,
    listEl,
    listID,
    order: [],
    committed: [],
    appended: new Set(),
    dirty: false,
  };
  listsByInternalId.set(internalId, state);
  listByListID.set(listID, state);
  return listEl;
}

/**
 * Record a `<list-item>` inserted into a `<list>`. We do NOT append it to the
 * list element here — the recycler attaches it on demand via
 * `componentAtIndex`. `anchorInternalId` is the real sibling to insert before,
 * or -1 to append.
 */
export function listInsertChild(
  listInternalId: number,
  childInternalId: number,
  anchorInternalId: number,
): void {
  const state = listsByInternalId.get(listInternalId);
  if (!state) return;
  const idx = anchorInternalId === -1 ? -1 : state.order.indexOf(anchorInternalId);
  if (idx === -1) state.order.push(childInternalId);
  else state.order.splice(idx, 0, childInternalId);
  listItemOwner.set(childInternalId, listInternalId);
  state.dirty = true;
}

/** Record a `<list-item>` removed from a `<list>` and detach its element. */
export function listRemoveChild(
  listInternalId: number,
  childInternalId: number,
): void {
  const state = listsByInternalId.get(listInternalId);
  if (!state) return;
  const idx = state.order.indexOf(childInternalId);
  if (idx !== -1) state.order.splice(idx, 1);
  if (state.appended.delete(childInternalId)) {
    const child = elements.get(childInternalId);
    if (child) __RemoveElement(state.listEl, child);
  }
  listItemOwner.delete(childInternalId);
  itemPlatformInfo.delete(childInternalId);
  state.dirty = true;
}

/** Tear down a `<list>` element (detach callbacks, drop all state). */
export function destroyListElement(internalId: number): void {
  const state = listsByInternalId.get(internalId);
  if (!state) return;
  __UpdateListCallbacks(state.listEl, null, null);
  listByListID.delete(state.listID);
  for (const childId of state.order) {
    listItemOwner.delete(childId);
    itemPlatformInfo.delete(childId);
  }
  listsByInternalId.delete(internalId);
}

/**
 * Record a platform-info prop on a `<list-item>`. Returns true if `key` is a
 * recognised platform-info key (the caller still sets it as a normal element
 * attribute regardless). Safe to call before the item's insert op arrives —
 * the info is stashed by child id and read at flush time.
 */
export function noteListItemProp(
  childInternalId: number,
  key: string,
  value: unknown,
): void {
  if (!PLATFORM_INFO_KEYS.has(key)) return;
  let info = itemPlatformInfo.get(childInternalId);
  if (!info) {
    info = {};
    itemPlatformInfo.set(childInternalId, info);
  }
  info[key] = value;
  const owner = listItemOwner.get(childInternalId);
  if (owner !== undefined) {
    const st = listsByInternalId.get(owner);
    if (st) st.dirty = true;
  }
}

/**
 * Emit `update-list-info` diffs for every list whose children changed during
 * the current ops batch. Called once per batch, before the final
 * `__FlushElementTree`.
 *
 * The diff is intentionally minimal — insert/remove only (no move/update). It
 * covers the common cases (initial render, append, delete). `removeAction`
 * carries ascending OLD indices; `insertAction` carries ascending NEW
 * positions, each with the item's type and platform info. This matches the
 * order the host/native recycler applies them (remove first, then insert).
 */
export function flushDirtyLists(): void {
  for (const state of listsByInternalId.values()) {
    if (!state.dirty) continue;
    state.dirty = false;

    const oldArr = state.committed;
    const newArr = state.order;
    const oldSet = new Set(oldArr);
    const newSet = new Set(newArr);

    const removeAction: number[] = [];
    for (let i = 0; i < oldArr.length; i++) {
      if (!newSet.has(oldArr[i])) removeAction.push(i);
    }

    const insertAction: Array<Record<string, unknown>> = [];
    for (let pos = 0; pos < newArr.length; pos++) {
      const childInternalId = newArr[pos];
      if (!oldSet.has(childInternalId)) {
        const info = itemPlatformInfo.get(childInternalId) ?? {};
        insertAction.push({ position: pos, type: 'list-item', ...info });
      }
    }

    state.committed = newArr.slice();

    if (removeAction.length === 0 && insertAction.length === 0) continue;

    __SetAttribute(state.listEl, 'update-list-info', {
      insertAction,
      removeAction,
      updateAction: [],
    });
    // Re-affirm the callbacks after every diff (mirrors the reference runtime).
    // Our closures read live state, so this is a defensive no-op rebind.
    __UpdateListCallbacks(state.listEl, componentAtIndex, enqueueComponent);
  }
}

/** Reset all list state — for testing and hot reload. */
export function resetListState(): void {
  listsByInternalId.clear();
  listByListID.clear();
  listItemOwner.clear();
  itemPlatformInfo.clear();
}
