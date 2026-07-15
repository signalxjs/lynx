/**
 * Main-thread snapshot runtime (#626, phase 2 of #620).
 *
 * Instantiates compiled snapshot templates (see
 * `@sigx/lynx-runtime-internal/snapshot` for the transform contract) on the
 * main thread. An instance is a cheap staged record until materialization —
 * `ensureElements()` runs the template's `create()` (direct element-PAPI
 * calls), applies `__SetCSSId`, then replays staged hole values through the
 * template's `update[i]` patchers. Lazy materialization is what makes a
 * future synchronous `componentAtIndex` free: offscreen rows stay as records.
 *
 * Integration points with the existing MT runtime:
 *  - Instances and their slot/inner elements resolve through the SAME
 *    `elements` map as op-built elements, so INSERT/REMOVE/SET_EVENT/
 *    SET_MT_REF/gesture ops work on template-built trees unchanged.
 *  - Template-INNER elements that need events/refs get synthetic NEGATIVE ids
 *    (BG-assigned ids are positive; the sign documents the origin) feeding
 *    the existing `event-slots.ts` state machine — the hybrid
 *    worklet+BG-handler slot behavior applies inside templates unchanged.
 *  - Hole updaters are installed into the contract module via
 *    `installSnapshotMTHooks()` (called from entry-main's bootstrap).
 *
 * The snapshot op protocol lives in ops-apply.ts (#629); BG-side emission in
 * lynx-runtime (#631); list templates, the synchronous `componentAtIndex`
 * pull path, and template-keyed recycling in list-mt.ts (#639).
 */

import {
  getSnapshotDef,
  installSnapshotHooks,
  type SnapshotDef,
  type SnapshotElement,
  type SnapshotHooks,
  type SnapshotInstanceLike,
} from '@sigx/lynx-runtime-internal/snapshot';
import { OP } from '@sigx/lynx-runtime-internal';
import { elements } from './element-registry.js';
import { clearElementSlots, setSlotBgSign, setSlotWorklet } from './event-slots.js';
// Call-time circular import (list-mt imports instance accessors from this
// module); neither side touches the other at module-eval time.
import { createListElementForSnapshot } from './list-mt.js';
import { bindMtRef, releaseMtRefBinding } from './mt-ref-bind.js';
import type { WorkletPlaceholder } from './worklet-events.js';

// ---------------------------------------------------------------------------
// Instance
// ---------------------------------------------------------------------------

export class MTSnapshotInstance implements SnapshotInstanceLike {
  /** BG-assigned instance id (positive) — also its key in `instances`. */
  readonly __id: number;
  readonly type: string;
  /** Dynamic hole values; staged until materialization, then live-patched. */
  __values: unknown[] = [];
  /** Elements from `create()`, or null while staged. */
  __elements: MainThreadElement[] | null = null;
  __element_root: MainThreadElement | null = null;
  readonly def: SnapshotDef;
  /** elementIndex → synthetic negative id (for event/ref plumbing). */
  syntheticIds: Map<number, number> = new Map();
  /** hole index → wvid currently bound through a ref hole (for teardown). */
  boundWvids: Map<number, number> = new Map();
  /** element-registry ids minted by SNAPSHOT_BIND_SLOT (for teardown). */
  slotElIds: Set<number> = new Set();

  constructor(id: number, type: string) {
    const def = getSnapshotDef(type);
    if (!def) {
      throw new Error(`[sigx-snapshot] unknown template "${type}" (instance ${id})`);
    }
    this.__id = id;
    this.type = type;
    this.def = def;
  }

  /**
   * Materialize: build the element tree and replay staged values. Idempotent.
   */
  ensureElements(): void {
    if (this.__elements) return;
    const create = this.def.create;
    if (!create) {
      throw new Error(
        `[sigx-snapshot] template "${this.type}" has no create() — `
          + 'background-target registration evaluated on the main thread?',
      );
    }
    const els = create(this) as MainThreadElement[];
    this.__elements = els;
    this.__element_root = els[0] ?? null;
    // cssId 0 — sigx runs unscoped CSS (`__SetCSSId([el], 0)` on every
    // op-built element); template cssIds are ignored the same way.
    __SetCSSId(els, 0);
    const update = this.def.update;
    if (update) {
      for (let i = 0; i < this.__values.length; i++) {
        if (this.__values[i] !== undefined && update[i]) {
          update[i](this, i, undefined);
        }
      }
    }
  }

  /**
   * Set hole `index`. Staged instances just record the value; materialized
   * ones patch through the template's updater with a direct-or-identical
   * skip (mirrors the reference `callUpdateIfNotDirectOrDeepEqual` gate —
   * wire values are JSON-decoded fresh objects, so `===` misses only
   * genuinely-equal structures, costing a redundant-but-idempotent patch).
   */
  setValue(index: number, value: unknown): void {
    const old = this.__values[index];
    this.__values[index] = value;
    if (!this.__elements) return;
    if (old === value) return;
    this.def.update?.[index]?.(this, index, old);
  }

  /**
   * Replace the whole values array (instantiation / reuse payload). Holes
   * beyond the new payload's length are cleared through their updaters
   * (stale values must not survive instance reuse), then the array shrinks
   * to match.
   */
  setValues(values: unknown[]): void {
    for (let i = 0; i < values.length; i++) {
      this.setValue(i, values[i]);
    }
    for (let i = values.length; i < this.__values.length; i++) {
      if (this.__values[i] !== undefined) this.setValue(i, undefined);
    }
    this.__values.length = values.length;
  }

  /**
   * Resolve the host element for slot `slotIndex` (where child content
   * attaches). Materializes on demand.
   */
  slotElement(slotIndex: number): MainThreadElement | null {
    const entry = this.def.slot?.[slotIndex];
    if (!entry) return null;
    this.ensureElements();
    return this.__elements?.[entry[1]] ?? null;
  }
}

// ---------------------------------------------------------------------------
// Instance registry + synthetic ids
// ---------------------------------------------------------------------------

const instances = new Map<number, MTSnapshotInstance>();

// Synthetic ids are negative and decrement. Start at -2: -1 is the op
// protocol's "append" anchor sentinel — it is never looked up, but keeping it
// out of the id space makes debugging saner.
let nextSyntheticId = -2;

export function createSnapshotInstance(id: number, type: string): MTSnapshotInstance {
  // Defensive: re-creating an id (HMR / duplicate-batch edges) must not leak
  // the previous instance's synthetic ids, slot state, or ref bindings.
  if (instances.has(id)) destroySnapshotInstance(id);
  const inst = new MTSnapshotInstance(id, type);
  instances.set(id, inst);
  return inst;
}

export function getSnapshotInstance(id: number): MTSnapshotInstance | undefined {
  return instances.get(id);
}

/** True when `id` names a live snapshot instance. */
export function isSnapshotInstance(id: number): boolean {
  return instances.has(id);
}

/**
 * Release an instance's element-side footprint — synthetic ids (+ their
 * event-slot state), ref bindings, bound slot-alias ids — and revert it to a
 * staged record (values kept, `instances` entry kept). For recycler paths
 * that discard a tree but must keep the row re-buildable on a later pull.
 */
export function dematerializeSnapshotInstance(inst: MTSnapshotInstance): void {
  for (const synId of inst.syntheticIds.values()) {
    clearElementSlots(synId);
    elements.delete(synId);
  }
  inst.syntheticIds.clear();
  for (const wvid of inst.boundWvids.values()) {
    releaseMtRefBinding(wvid);
  }
  inst.boundWvids.clear();
  for (const slotElId of inst.slotElIds) {
    clearElementSlots(slotElId);
    elements.delete(slotElId);
  }
  inst.slotElIds.clear();
  inst.__elements = null;
  inst.__element_root = null;
}

/**
 * Drop an instance and every registry entry it minted: synthetic ids in
 * `elements` (which would pin the whole subtree), their event-slot state,
 * and any ref bindings its holes created.
 */
export function destroySnapshotInstance(id: number): void {
  const inst = instances.get(id);
  if (!inst) return;
  for (const synId of inst.syntheticIds.values()) {
    clearElementSlots(synId);
    elements.delete(synId);
  }
  for (const wvid of inst.boundWvids.values()) {
    releaseMtRefBinding(wvid);
  }
  for (const slotElId of inst.slotElIds) {
    clearElementSlots(slotElId);
    elements.delete(slotElId);
  }
  instances.delete(id);
}

/**
 * Register template-inner element `elementIndex` of `inst` under a synthetic
 * negative id in the shared `elements` map, so the event-slot machinery and
 * ref binding address it exactly like an op-built element.
 */
export function ensureSyntheticId(inst: MTSnapshotInstance, elementIndex: number): number {
  const existing = inst.syntheticIds.get(elementIndex);
  if (existing !== undefined) return existing;
  inst.ensureElements();
  const el = inst.__elements?.[elementIndex];
  if (!el) {
    throw new Error(
      `[sigx-snapshot] template "${inst.type}" has no element at index ${elementIndex}`,
    );
  }
  const synId = nextSyntheticId--;
  inst.syntheticIds.set(elementIndex, synId);
  elements.set(synId, el);
  return synId;
}

/** Test / hot-reload reset. */
export function resetSnapshotInstances(): void {
  for (const inst of instances.values()) {
    for (const synId of inst.syntheticIds.values()) {
      clearElementSlots(synId);
      elements.delete(synId);
    }
    for (const wvid of inst.boundWvids.values()) {
      releaseMtRefBinding(wvid);
    }
    for (const slotElId of inst.slotElIds) {
      clearElementSlots(slotElId);
      elements.delete(slotElId);
    }
  }
  instances.clear();
  nextSyntheticId = -2;
  parked.clear();
  parkedSlotIds.clear();
}

// ---------------------------------------------------------------------------
// Park-and-retry (#637). Dev HMR delivers template registrations and the op
// batches that use them over two unordered channels — a SNAPSHOT_CREATE can
// name a uniqID whose registration hasn't arrived yet. Park the create plus
// every op targeting its id, and replay after the next
// `sigxApplyMtHotUpdate` registers the template.
// ---------------------------------------------------------------------------

/** Hot-update cycles a parked create may survive before being dropped. */
const PARK_MAX_AGE = 3;

interface ParkedCreate {
  id: number;
  templateId: string;
  /** Raw op tuples targeting `id`, replayed in arrival order on retry. */
  queued: unknown[][];
  age: number;
}

const parked = new Map<number, ParkedCreate>();
/** slotElId (from a queued BIND_SLOT) → owning parked instance id. */
const parkedSlotIds = new Map<number, number>();

/** Park a SNAPSHOT_CREATE whose template isn't registered (yet). */
export function parkSnapshotCreate(id: number, templateId: string): void {
  parked.set(id, { id, templateId, queued: [], age: 0 });
}

export function isParkedSnapshot(id: number): boolean {
  return parked.has(id);
}

/**
 * Resolve an id that belongs to a parked instance's world: the instance id
 * itself, or a slot-el id from one of its queued BIND_SLOTs (the BG replays
 * slot children with parentId = slotElId — those INSERTs must queue too).
 */
export function parkedOwnerOf(id: number): number | undefined {
  if (parked.has(id)) return id;
  return parkedSlotIds.get(id);
}

/** Queue a raw op tuple (opcode-first) that targets a parked instance id. */
export function queueOpForParked(id: number, tuple: unknown[]): void {
  const owner = parkedOwnerOf(id);
  if (owner === undefined) return;
  parked.get(owner)?.queued.push(tuple);
  // A queued BIND_SLOT mints a slot-el id whose later child INSERTs name it
  // as PARENT — track it so they route here as well.
  if (tuple[0] === OP.SNAPSHOT_BIND_SLOT) {
    parkedSlotIds.set(tuple[3] as number, owner);
  }
}

function clearParkedSlotIds(ownerId: number): void {
  for (const [slotId, owner] of parkedSlotIds) {
    if (owner === ownerId) parkedSlotIds.delete(slotId);
  }
}

/** Drop one parked create (its subtree was removed before it could resolve). */
export function dropParkedSnapshot(id: number): void {
  parked.delete(id);
  clearParkedSlotIds(id);
}

/**
 * Called after each `sigxApplyMtHotUpdate`: creates whose templates are now
 * registered replay as a real op batch (SNAPSHOT_CREATE + their queued ops,
 * in order) through `applyBatch`; the rest age out with a loud log after
 * PARK_MAX_AGE cycles.
 */
export function retryParkedSnapshots(applyBatch: (ops: unknown[]) => void): void {
  if (parked.size === 0) return;
  const ready: ParkedCreate[] = [];
  // Only the CURRENT entry is ever deleted mid-iteration — safe on a Map.
  for (const entry of parked.values()) {
    if (getSnapshotDef(entry.templateId)) {
      parked.delete(entry.id);
      // Clear the slot-id aliases BEFORE replaying, or the replayed child
      // INSERTs would re-queue into the just-deleted entry and vanish.
      clearParkedSlotIds(entry.id);
      ready.push(entry);
    } else if (++entry.age >= PARK_MAX_AGE) {
      parked.delete(entry.id);
      clearParkedSlotIds(entry.id);
      console.log(
        `[sigx-snapshot] dropping parked instance ${entry.id}: template `
          + `"${entry.templateId}" never arrived after ${PARK_MAX_AGE} hot updates`,
      );
    }
  }
  for (const entry of ready) {
    const batch: unknown[] = [OP.SNAPSHOT_CREATE, entry.id, entry.templateId];
    for (const tuple of entry.queued) batch.push(...tuple);
    applyBatch(batch);
  }
}

// ---------------------------------------------------------------------------
// Hole-updater hooks (installed into the contract module by entry-main)
// ---------------------------------------------------------------------------

/**
 * Platform-info keys never applied as element attributes when they arrive
 * through the list-item platform-info hole — `reuse-identifier` and
 * `recyclable` are recycler metadata only (mirrors the reference
 * `platformInfoVirtualAttributes`).
 */
const VIRTUAL_PLATFORM_INFO_KEYS = new Set(['reuse-identifier', 'recyclable']);

function asInstance(ctx: SnapshotInstanceLike): MTSnapshotInstance {
  return ctx as MTSnapshotInstance;
}

const mtHooks: SnapshotHooks = {
  // Wire value for an event hole is the BG event-registry sign (a string) or
  // undefined to unregister. Routed through the event-slot state machine so
  // batching + hybrid (worklet + BG handler on one slot) semantics hold.
  updateEvent(ctx, index, _old, elementIndex, eventType, eventName, _spreadKey) {
    const inst = asInstance(ctx);
    const value = inst.__values[index];
    const synId = ensureSyntheticId(inst, elementIndex);
    setSlotBgSign(synId, eventType, eventName, typeof value === 'string' ? value : undefined);
  },

  // Wire value is the sanitized worklet ctx ({ _wkltId, _c?, _execId? }).
  updateWorkletEvent(ctx, index, _old, elementIndex, workletType, eventType, eventName) {
    const inst = asInstance(ctx);
    const value = inst.__values[index] as WorkletPlaceholder | undefined;
    const synId = ensureSyntheticId(inst, elementIndex);
    // Stamp the ctx like the op path (SET_WORKLET_EVENT) does — native
    // worklet dispatch keys off _workletType. Honor the transform-provided
    // type ('main-thread' today).
    if (value && value._wkltId) {
      (value as unknown as Record<string, unknown>)['_workletType'] = workletType || 'main-thread';
    }
    setSlotWorklet(synId, eventType, eventName, value ?? undefined);
  },

  // Plain refs and worklet refs share the wire shape { __wvid } (BG
  // normalizes both — MainThreadRef is the only ref primitive on this side).
  updateRef(ctx, index, old, elementIndex) {
    mtHooks.updateWorkletRef(ctx, index, old, elementIndex);
  },

  updateWorkletRef(ctx, index, _old, elementIndex) {
    const inst = asInstance(ctx);
    const value = inst.__values[index] as { __wvid?: number } | null | undefined;
    const wvid = value?.__wvid;
    // Unbind on clear or wvid change so gesture resolution can't hit a stale
    // element and the binding map doesn't leak across updates.
    const prevWvid = inst.boundWvids.get(index);
    if (prevWvid !== undefined && prevWvid !== wvid) {
      releaseMtRefBinding(prevWvid);
      inst.boundWvids.delete(index);
    }
    if (typeof wvid !== 'number') return;
    const synId = ensureSyntheticId(inst, elementIndex);
    const el = elements.get(synId);
    if (el) {
      bindMtRef(el, synId, wvid);
      inst.boundWvids.set(index, wvid);
    }
  },

  // sigx gestures flow through `main-thread:ref` + useGestureDetector ops,
  // not through template holes — the transform only emits this for
  // ReactLynx-style gesture props, which sigx JSX doesn't produce. Warn so a
  // future divergence is visible instead of silent.
  updateGesture(ctx, _index, _old, _elementIndex) {
    console.log(
      `[sigx-snapshot] updateGesture is not supported (template "${asInstance(ctx).type}") — `
        + 'use main-thread:ref + useGestureDetector',
    );
  },

  // Spread hole: the wire value is a plain object of already-normalized
  // entries. Route each key like the op path would.
  updateSpread(ctx, index, oldValue, elementIndex) {
    const inst = asInstance(ctx);
    inst.ensureElements();
    const el = inst.__elements?.[elementIndex];
    if (!el) return;
    const next = (inst.__values[index] ?? {}) as Record<string, unknown>;
    const prev = (oldValue ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(prev)) {
      if (!(key in next)) applySpreadEntry(inst, el, elementIndex, key, undefined);
    }
    for (const [key, value] of Object.entries(next)) {
      if (prev[key] !== value) applySpreadEntry(inst, el, elementIndex, key, value);
    }
  },

  // List-item platform info ({ 'item-key': …, 'estimated-main-axis-size-px':
  // …, … }): applied as element attributes (minus virtual keys) so native
  // list bookkeeping sees them; update-list-info mirroring arrives with the
  // list integration phase.
  updateListItemPlatformInfo(ctx, index, oldValue, elementIndex) {
    const inst = asInstance(ctx);
    inst.ensureElements();
    const el = inst.__elements?.[elementIndex];
    if (!el) return;
    const info = (inst.__values[index] ?? {}) as Record<string, unknown>;
    const prev = (oldValue ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(prev)) {
      if (VIRTUAL_PLATFORM_INFO_KEYS.has(key)) continue;
      if (!(key in info)) __SetAttribute(el, key, undefined);
    }
    for (const [key, value] of Object.entries(info)) {
      if (VIRTUAL_PLATFORM_INFO_KEYS.has(key)) continue;
      if (prev[key] !== value) __SetAttribute(el, key, value);
    }
  },

  // Compiled `<list>` create bodies: a real __CreateList with the recycler
  // callbacks, state keyed by the template instance's BG id (list-mt.ts).
  createList(_pageId, ctx, _expIndex): SnapshotElement {
    return createListElementForSnapshot(asInstance(ctx));
  },
};

/**
 * Parse a spread event key to its canonical `__AddEvent` type + name.
 * Mirrors the BG renderer's `parseEventProp` (nodeOps.ts) exactly —
 * including the `bindingx` false-positive guard — minus the `on*` alias
 * (spread wire values are already kebab-case by the time they reach MT).
 */
function parseSpreadEventKey(key: string): { type: string; name: string } | null {
  if (key.startsWith('main-thread-bind')) {
    return { type: 'bindEvent', name: key.slice('main-thread-bind'.length) };
  }
  if (key.startsWith('main-thread-catch')) {
    return { type: 'catchEvent', name: key.slice('main-thread-catch'.length) };
  }
  if (key.startsWith('main-thread:bind')) {
    return { type: 'bindEvent', name: key.slice('main-thread:bind'.length) };
  }
  if (key.startsWith('main-thread:catch')) {
    return { type: 'catchEvent', name: key.slice('main-thread:catch'.length) };
  }
  if (key.startsWith('global-bind')) {
    return { type: 'bindGlobalEvent', name: key.slice('global-bind'.length) };
  }
  if (key.startsWith('global-catch')) {
    return { type: 'catchGlobalEvent', name: key.slice('global-catch'.length) };
  }
  if (key.startsWith('catch')) {
    return { type: 'catchEvent', name: key.slice('catch'.length) };
  }
  if (/^bind(?!ingx)/.test(key)) {
    return { type: 'bindEvent', name: key.slice('bind'.length) };
  }
  return null;
}

function applySpreadEntry(
  inst: MTSnapshotInstance,
  el: MainThreadElement,
  elementIndex: number,
  key: string,
  value: unknown,
): void {
  if (key === 'style') {
    __SetInlineStyles(el, (value ?? {}) as Record<string, string | number>);
    return;
  }
  if (key === 'class' || key === 'className') {
    __SetClasses(el, String(value ?? ''));
    return;
  }
  if (key === 'id') {
    // undefined clears; '' would be a real (empty) id on some hosts.
    __SetID(el, value == null ? undefined : String(value));
    return;
  }
  const event = parseSpreadEventKey(key);
  if (event) {
    const synId = ensureSyntheticId(inst, elementIndex);
    if (value && typeof value === 'object' && '_wkltId' in (value as object)) {
      // Same ctx stamp as the non-spread path / SET_WORKLET_EVENT op.
      (value as Record<string, unknown>)['_workletType'] = 'main-thread';
      setSlotWorklet(synId, event.type, event.name, value as WorkletPlaceholder);
    } else {
      setSlotBgSign(synId, event.type, event.name, typeof value === 'string' ? value : undefined);
    }
    return;
  }
  __SetAttribute(el, key, value);
}

/**
 * Install the MT hole updaters into the shared contract module. Called once
 * from entry-main's bootstrap (before any user module evaluates). Idempotent.
 */
export function installSnapshotMTHooks(): void {
  installSnapshotHooks(mtHooks);
}
