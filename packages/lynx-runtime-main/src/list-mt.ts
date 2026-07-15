/**
 * Main Thread native `<list>` recycler support.
 *
 * Lynx's `<list>` is NOT a plain scrolling container — it's a managed recycler.
 * Native pulls each visible cell by calling `componentAtIndex(cellIndex)` and
 * recycles offscreen cells via `enqueueComponent(sign)`. If its
 * `update-list-info` metadata is never set, native crashes during layout
 * (`UIList.onLayoutCompleted` NPE — issue #120).
 *
 * Two kinds of cells coexist (#620):
 *
 *  - **Eager per-element cells** (the pre-snapshot path, still used by
 *    library dists and non-compiled subtrees): the Background Thread builds
 *    the whole `<list-item>` subtree through element ops; `componentAtIndex`
 *    just returns the prebuilt element's sign, and `enqueueComponent` is a
 *    no-op (each row owns its dedicated subtree).
 *
 *  - **Snapshot-template cells** (compiled `<list-item>` subtrees): rows stay
 *    cheap STAGED instance records — `order[]` of instance ids IS the row
 *    manifest — and `componentAtIndex` materializes the pulled cell
 *    synchronously (`ensureElements()` + append + flush), so a fling can
 *    never observe a blank cell. `enqueueComponent` is REAL here: the cell's
 *    elements move into a pool keyed by `templateId|reuse-identifier`, and a
 *    later pull for a same-shaped row ADOPTS a pooled tree and re-patches its
 *    dynamic holes instead of constructing.
 *
 * A compiled `<list>` itself is a template whose `create()` calls
 * `snapshotCreateList` (→ `createListElementForSnapshot` here), and whose
 * ListSlotV2 slot id is registered as an ALIAS of the list state
 * (`registerListSlotAlias`) so ordinary INSERT/REMOVE ops of item instances
 * route through `listInsertChild`/`listRemoveChild` unchanged.
 *
 * What this module owns:
 *  - Creating `<list>` via `__CreateList` (so the callbacks are registered).
 *  - Tracking each list's ordered children (BG insertion order) and their
 *    per-item platform info (item-key etc.) — for staged snapshot cells the
 *    info is read from the instance's platform-info hole (`__values[0]`,
 *    shape-validated; the transform pins it there) at flush time.
 *  - Emitting `update-list-info` diffs (insert/remove actions) at the end of
 *    each ops batch. Like the eager path, per-item info is carried at
 *    insert time only (`updateAction` stays empty).
 *  - The recycle pools and sign → row bookkeeping for template cells.
 *
 * `<list-item>` children are intercepted here instead of being appended to the
 * list element directly (the recycler owns attachment via `componentAtIndex`).
 */

import { elements, pageUniqueId } from './element-registry.js';
import { clearElementSlots, flushDirtySlots } from './event-slots.js';
import { releaseMtRefBinding } from './mt-ref-bind.js';
// Call-time circular import: snapshot-mt's createList hook calls back into
// createListElementForSnapshot below. Neither module touches the other at
// module-eval time, so initialization order is irrelevant.
import {
  destroySnapshotInstance,
  getSnapshotInstance,
  isSnapshotInstance,
  type MTSnapshotInstance,
} from './snapshot-mt.js';

/**
 * Per-`<list-item>` platform-info attribute keys (kebab-case). These are
 * forwarded to native both as element attributes (via SET_PROP /
 * `updateListItemPlatformInfo`) and inside `update-list-info`'s insertAction
 * entries.
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

/** A recycled template cell's transferable parts (see enqueueComponent). */
interface PoolEntry {
  elements: MainThreadElement[];
  root: MainThreadElement;
  /** Hole values the pooled tree currently displays (re-patch baseline). */
  values: unknown[];
  syntheticIds: Map<number, number>;
  boundWvids: Map<number, number>;
}

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
  /** Extra `listsByInternalId` keys pointing at this state (slot aliases). */
  aliases: Set<number>;
  /** sign (PAPI unique id) → child internal id, populated at pull time. */
  signToChild: Map<number, number>;
  /** `${templateId}|${reuse-identifier}` → recycled cell trees. */
  pools: Map<string, PoolEntry[]>;
  dirty: boolean;
}

const listsByInternalId = new Map<number, ListState>();
const listByListID = new Map<number, ListState>();
/** child internal id → owning list internal id */
const listItemOwner = new Map<number, number>();
/** child internal id → per-item platform info ({ 'item-key': … }) */
const itemPlatformInfo = new Map<number, Record<string, unknown>>();

/** True when `internalId` is a `<list>` element (or alias) managed here. */
export function isListElement(internalId: number): boolean {
  return listsByInternalId.has(internalId);
}

/** True when `internalId` is a direct `<list-item>` child of some `<list>`. */
export function isListChild(internalId: number): boolean {
  return listItemOwner.has(internalId);
}

// ---------------------------------------------------------------------------
// Snapshot-cell helpers
// ---------------------------------------------------------------------------

/**
 * Platform info for a row: eager cells populate `itemPlatformInfo` through
 * SET_PROP (`noteListItemProp`); staged/materialized template cells carry it
 * in their platform-info hole — always `__values[0]` (the transform hoists
 * list-item platform attributes there; verified against transform output),
 * shape-validated so a template without platform attrs can't leak an
 * unrelated hole into `update-list-info`.
 */
function platformInfoFor(childInternalId: number): Record<string, unknown> {
  const cached = itemPlatformInfo.get(childInternalId);
  if (cached) return cached;
  const inst = getSnapshotInstance(childInternalId);
  const v0 = inst?.__values[0];
  if (
    v0 !== null && typeof v0 === 'object' && !Array.isArray(v0)
    && Object.keys(v0 as object).every((k) => PLATFORM_INFO_KEYS.has(k))
  ) {
    return v0 as Record<string, unknown>;
  }
  return {};
}

function reuseKeyOf(inst: MTSnapshotInstance): string {
  const reuseId = platformInfoFor(inst.__id)['reuse-identifier'];
  return `${inst.type}|${typeof reuseId === 'string' ? reuseId : ''}`;
}

/**
 * Adopt a pooled cell tree into `inst`, then re-patch every dynamic hole with
 * the pooled tree's previous values as the `oldValue` baseline. Updaters are
 * idempotent and diff-aware (spread/platform-info unset removed keys; event
 * holes re-sign their slots), so running all of them unconditionally is both
 * simplest and correct — construction is what recycling avoids, not patching.
 */
function adoptPooled(inst: MTSnapshotInstance, entry: PoolEntry): void {
  inst.__elements = entry.elements;
  inst.__element_root = entry.root;
  inst.syntheticIds = entry.syntheticIds;
  inst.boundWvids = entry.boundWvids;
  // Synthetic-id registry entries survived pooling (the pool owned them);
  // re-set defensively in case a reset raced.
  for (const [elementIndex, synId] of entry.syntheticIds) {
    const el = entry.elements[elementIndex];
    if (el) elements.set(synId, el);
  }
  const update = inst.def.update;
  if (update) {
    const max = Math.max(inst.__values.length, entry.values.length);
    for (let i = 0; i < max; i++) {
      update[i]?.(inst, i, entry.values[i]);
    }
  }
}

/** Free a pool entry's registry footprint (list teardown). */
function releasePoolEntry(entry: PoolEntry): void {
  for (const synId of entry.syntheticIds.values()) {
    clearElementSlots(synId);
    elements.delete(synId);
  }
  for (const wvid of entry.boundWvids.values()) {
    releaseMtRefBinding(wvid);
  }
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

  let root = elements.get(childInternalId);
  if (!root) {
    // Snapshot cell: staged (never built) or recycled-away (elements pooled).
    // Build it SYNCHRONOUSLY — adopt + re-patch from the pool when a
    // same-shaped tree is available, construct otherwise. Never awaits.
    const inst = getSnapshotInstance(childInternalId);
    if (!inst) return -1;
    if (!inst.__elements) {
      const pool = state.pools.get(reuseKeyOf(inst));
      const entry = pool?.pop();
      if (entry) adoptPooled(inst, entry);
      else inst.ensureElements();
    }
    if (!inst.__element_root) return -1;
    root = inst.__element_root;
    // Cells resolve by instance id, never tree position (component mounts
    // put comment anchors next to template roots).
    elements.set(childInternalId, root);
  }

  const sign = __GetElementUniqueID(root);
  state.signToChild.set(sign, childInternalId);
  // Append on first pull so native can resolve the cell by sign; the guard
  // prevents a double-append when the cell scrolls back into view.
  if (!state.appended.has(childInternalId)) {
    __AppendElement(state.listEl, root);
    state.appended.add(childInternalId);
  }
  // Event holes patched during materialize/adopt sit in the slot state
  // machine until flushed; this pull's cell must carry its handlers NOW.
  flushDirtySlots();
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
  listID: number,
  sign: number,
): void {
  const state = listByListID.get(listID);
  if (!state) return;
  const childInternalId = state.signToChild.get(sign);
  if (childInternalId === undefined) return;
  const inst = getSnapshotInstance(childInternalId);
  // Eager per-element cells keep the historical no-op: each row owns its
  // dedicated subtree, native merely detaches the offscreen view.
  if (!inst || !inst.__elements || !inst.__element_root) return;

  // Detach and move the tree into the pool; the instance reverts to a staged
  // record (future SET_VALUEs stage into __values until the next pull).
  if (state.appended.delete(childInternalId)) {
    __RemoveElement(state.listEl, inst.__element_root);
  }
  state.signToChild.delete(sign);
  elements.delete(childInternalId);
  const key = reuseKeyOf(inst);
  let pool = state.pools.get(key);
  if (!pool) {
    pool = [];
    state.pools.set(key, pool);
  }
  pool.push({
    elements: inst.__elements,
    root: inst.__element_root,
    values: inst.__values.slice(),
    syntheticIds: inst.syntheticIds,
    boundWvids: inst.boundWvids,
  });
  inst.__elements = null;
  inst.__element_root = null;
  inst.syntheticIds = new Map();
  inst.boundWvids = new Map();
}

// ---------------------------------------------------------------------------
// Lifecycle, invoked from ops-apply.ts / snapshot-mt.ts
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
    aliases: new Set(),
    signToChild: new Map(),
    pools: new Map(),
    dirty: false,
  };
  listsByInternalId.set(internalId, state);
  listByListID.set(listID, state);
  return listEl;
}

/**
 * `snapshotCreateList` target (compiled `<list>` create bodies, routed via
 * snapshot-mt's createList hook). The template instance's BG id keys the
 * state, so REMOVE of the instance tears the list down through the same
 * `destroyListElement` path as op-built lists.
 */
export function createListElementForSnapshot(inst: MTSnapshotInstance): MainThreadElement {
  return createListElement(inst.__id);
}

/**
 * Register a bound ListSlotV2 slot id as an alias of its list's state, so
 * INSERT/REMOVE ops naming the slot as parent route through
 * `listInsertChild`/`listRemoveChild` (the BG inserts item instances into
 * the slot element — see nodeOps' bind replay).
 */
export function registerListSlotAlias(listInternalId: number, aliasId: number): void {
  const state = listsByInternalId.get(listInternalId);
  if (!state) return;
  listsByInternalId.set(aliasId, state);
  state.aliases.add(aliasId);
}

/**
 * Record a `<list-item>` inserted into a `<list>`. We do NOT append it to the
 * list element here — the recycler attaches it on demand via
 * `componentAtIndex`. `anchorInternalId` is the real sibling to insert before,
 * or -1 to append.
 *
 * An insert of a child that is already in the list is a MOVE: the BG shadow
 * tree detaches implicitly on insertBefore and emits no REMOVE op (keyed
 * reorders arrive as bare inserts), so drop the old occurrence first —
 * before the anchor lookup, so the anchor index isn't stale.
 */
export function listInsertChild(
  listInternalId: number,
  childInternalId: number,
  anchorInternalId: number,
): void {
  const state = listsByInternalId.get(listInternalId);
  if (!state) return;
  // Remove ALL prior occurrences (not just the first) so the move logic
  // self-heals even if `order` was ever corrupted by an earlier batch.
  for (
    let existing = state.order.indexOf(childInternalId);
    existing !== -1;
    existing = state.order.indexOf(childInternalId)
  ) {
    state.order.splice(existing, 1);
  }
  const idx = anchorInternalId === -1 ? -1 : state.order.indexOf(anchorInternalId);
  if (idx === -1) state.order.push(childInternalId);
  else state.order.splice(idx, 0, childInternalId);
  // Aliases share one state; own the child under the canonical id.
  listItemOwner.set(childInternalId, state.internalId);
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
  // Snapshot cell teardown (its LIVE elements only — a pooled tree this
  // instance recycled away is owned by the pool and stays reusable).
  if (isSnapshotInstance(childInternalId)) {
    destroySnapshotInstance(childInternalId);
    elements.delete(childInternalId);
    for (const [sign, cid] of state.signToChild) {
      if (cid === childInternalId) state.signToChild.delete(sign);
    }
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
    if (isSnapshotInstance(childId)) {
      destroySnapshotInstance(childId);
      elements.delete(childId);
    }
  }
  for (const pool of state.pools.values()) {
    for (const entry of pool) releasePoolEntry(entry);
  }
  for (const aliasId of state.aliases) {
    listsByInternalId.delete(aliasId);
  }
  listsByInternalId.delete(state.internalId);
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
 * Set of values in `seq` forming one longest strictly-increasing subsequence
 * (patience sorting, O(n log n)). Used to pick the "stable backbone" of a
 * keyed reorder — the kept items whose relative order did not change.
 */
function longestIncreasingSubsequence(seq: number[]): Set<number> {
  // tails[k] = index into seq of the smallest tail among increasing
  // subsequences of length k+1; prev[] links reconstruct the chain.
  const tails: number[] = [];
  const prev = new Array<number>(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const stable = new Set<number>();
  let k = tails.length > 0 ? tails[tails.length - 1] : -1;
  while (k !== -1) {
    stable.add(seq[k]);
    k = prev[k];
  }
  return stable;
}

/**
 * Emit `update-list-info` diffs for every list whose children changed during
 * the current ops batch. Called once per batch, before the final
 * `__FlushElementTree`.
 *
 * The wire format is insert/remove only, so a MOVE (keyed reorder) is encoded
 * as remove + re-insert. Kept items whose relative order is unchanged — the
 * longest increasing subsequence of old indices taken in new order — stay put;
 * every other item is removed and re-inserted at its new position, so applying
 * the diff reproduces `state.order` exactly on native. `removeAction` carries
 * ascending OLD indices; `insertAction` carries ascending NEW positions, each
 * with the item's type and platform info. This matches the order the
 * host/native recycler applies them (remove first, then insert).
 */
export function flushDirtyLists(): void {
  for (const state of listsByInternalId.values()) {
    if (!state.dirty) continue;
    state.dirty = false;

    const oldArr = state.committed;
    const newArr = state.order;
    const newSet = new Set(newArr);
    const oldIndex = new Map<number, number>();
    for (let i = 0; i < oldArr.length; i++) oldIndex.set(oldArr[i], i);

    // Old indices of kept items, in NEW order; their LIS is the backbone
    // that needs no action.
    const keptOldIndices: number[] = [];
    for (const id of newArr) {
      const oi = oldIndex.get(id);
      if (oi !== undefined) keptOldIndices.push(oi);
    }
    const stable = longestIncreasingSubsequence(keptOldIndices);

    const removeAction: number[] = [];
    for (let i = 0; i < oldArr.length; i++) {
      if (!newSet.has(oldArr[i]) || !stable.has(i)) removeAction.push(i);
    }

    const insertAction: Array<Record<string, unknown>> = [];
    for (let pos = 0; pos < newArr.length; pos++) {
      const childInternalId = newArr[pos];
      const oi = oldIndex.get(childInternalId);
      if (oi === undefined || !stable.has(oi)) {
        insertAction.push({
          position: pos,
          type: 'list-item',
          ...platformInfoFor(childInternalId),
        });
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
