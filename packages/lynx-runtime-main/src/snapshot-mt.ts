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
 * NOT here (later phases): the snapshot op protocol (#620 phase 3), BG-side
 * emission (phase 4), list templates + recycling (phase 5). `createList`
 * throws descriptively until phase 5.
 */

import {
  getSnapshotDef,
  installSnapshotHooks,
  type SnapshotDef,
  type SnapshotElement,
  type SnapshotHooks,
  type SnapshotInstanceLike,
} from '@sigx/lynx-runtime-internal/snapshot';
import { elements } from './element-registry.js';
import { setSlotBgSign, setSlotWorklet } from './event-slots.js';
import { bindMtRef } from './mt-ref-bind.js';
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

  /** Replace the whole values array (instantiation payload). */
  setValues(values: unknown[]): void {
    for (let i = 0; i < values.length; i++) {
      this.setValue(i, values[i]);
    }
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
 * Drop an instance and every registry entry it minted (synthetic ids stay in
 * `elements` otherwise and would pin the whole subtree).
 */
export function destroySnapshotInstance(id: number): void {
  const inst = instances.get(id);
  if (!inst) return;
  for (const synId of inst.syntheticIds.values()) {
    elements.delete(synId);
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
      elements.delete(synId);
    }
  }
  instances.clear();
  nextSyntheticId = -2;
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
  updateWorkletEvent(ctx, index, _old, elementIndex, _workletType, eventType, eventName) {
    const inst = asInstance(ctx);
    const value = inst.__values[index] as WorkletPlaceholder | undefined;
    const synId = ensureSyntheticId(inst, elementIndex);
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
    if (typeof wvid !== 'number') return;
    const synId = ensureSyntheticId(inst, elementIndex);
    const el = elements.get(synId);
    if (el) bindMtRef(el, synId, wvid);
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
  updateListItemPlatformInfo(ctx, index, _old, elementIndex) {
    const inst = asInstance(ctx);
    inst.ensureElements();
    const el = inst.__elements?.[elementIndex];
    if (!el) return;
    const info = (inst.__values[index] ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(info)) {
      if (VIRTUAL_PLATFORM_INFO_KEYS.has(key)) continue;
      __SetAttribute(el, key, value);
    }
  },

  // List templates land with the list-integration phase (#620 phase 5).
  createList(_pageId, ctx, _expIndex): SnapshotElement {
    throw new Error(
      `[sigx-snapshot] <list> templates are not supported yet (template "${asInstance(ctx).type}")`,
    );
  },
};

const EVENT_KEY_RE = /^(?:main-thread:)?(?:bind|catch|capture-bind|capture-catch|global-bind)(.+)$/;

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
    __SetID(el, String(value ?? ''));
    return;
  }
  const eventMatch = EVENT_KEY_RE.exec(key);
  if (eventMatch) {
    const synId = ensureSyntheticId(inst, elementIndex);
    const eventName = eventMatch[1];
    if (value && typeof value === 'object' && '_wkltId' in (value as object)) {
      setSlotWorklet(synId, 'bindEvent', eventName, value as WorkletPlaceholder);
    } else {
      setSlotBgSign(synId, 'bindEvent', eventName, typeof value === 'string' ? value : undefined);
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
