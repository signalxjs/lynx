/**
 * MT-side per-slot event registration state machine.
 *
 * Lynx native's `__AddEvent(el, eventType, eventName, value)` only stores ONE
 * value per `(el, eventType, eventName)` slot — the second call wins. When
 * sigx user code declares both a `main-thread-bind*` worklet AND a regular
 * `bind*` BG handler on the same element, two ops arrive in the same patch
 * batch (SET_WORKLET_EVENT + SET_EVENT). Calling `__AddEvent` eagerly per op
 * means the second one silently overwrites the first.
 *
 * This module defers the `__AddEvent` call. Each op updates per-slot state
 * (`worklet?`, `bgSign?`) and marks the slot dirty. After the entire op
 * batch is processed (`flushDirtySlots` is called at the tail of `applyOps`),
 * we issue ONE `__AddEvent` per dirty slot using whichever shape combines
 * the present handlers — string sign, worklet ctx, or hybrid ctx.
 *
 * State persists across batches because re-renders may update only one of
 * the two handlers (the BG event-registry already deduplicates SET_EVENT
 * after the first registration, and `sentWorklets` deduplicates
 * SET_WORKLET_EVENT by `_wkltId`).
 */

import { elements } from './element-registry.js';
import { hybridCtx } from './hybrid-worklet.js';
import type { WorkletPlaceholder } from './worklet-events.js';

interface SlotState {
  worklet?: WorkletPlaceholder;
  bgSign?: string;
  /** Last value passed to __AddEvent, kept for skip-if-unchanged diffing. */
  installed?: unknown;
}

/** elementId → typeName ('bindEvent:tap' etc.) → slot state */
const slotStates = new Map<number, Map<string, SlotState>>();
/** Set of `${elementId}|${typeName}` keys that need __AddEvent re-issuing. */
const dirtySlots = new Set<string>();

function getOrCreateSlot(elId: number, type: string, name: string): SlotState {
  let perEl = slotStates.get(elId);
  if (!perEl) {
    perEl = new Map();
    slotStates.set(elId, perEl);
  }
  const typeName = `${type}:${name}`;
  let slot = perEl.get(typeName);
  if (!slot) {
    slot = {};
    perEl.set(typeName, slot);
  }
  return slot;
}

function markDirty(elId: number, type: string, name: string): void {
  dirtySlots.add(`${elId}|${type}:${name}`);
}

export function setSlotWorklet(
  elId: number,
  type: string,
  name: string,
  ctx: WorkletPlaceholder | undefined,
): void {
  const slot = getOrCreateSlot(elId, type, name);
  slot.worklet = ctx;
  markDirty(elId, type, name);
}

export function setSlotBgSign(
  elId: number,
  type: string,
  name: string,
  sign: string | undefined,
): void {
  const slot = getOrCreateSlot(elId, type, name);
  slot.bgSign = sign;
  markDirty(elId, type, name);
}

/**
 * Pick the right __AddEvent value given which handlers are present.
 * Returns `undefined` to mean "unregister this slot".
 */
function computeAddEventValue(slot: SlotState): unknown {
  const { worklet, bgSign } = slot;
  if (!worklet && !bgSign) return undefined;
  if (worklet && !bgSign) {
    return { type: 'worklet', value: worklet };
  }
  if (!worklet && bgSign) {
    return bgSign;
  }
  return { type: 'worklet', value: hybridCtx(worklet!, bgSign!) };
}

/**
 * Commit __AddEvent for every slot that changed since the last flush.
 * Called from `applyOps` after the op loop, before `__FlushElementTree()`.
 */
export function flushDirtySlots(): void {
  for (const key of dirtySlots) {
    const sep = key.indexOf('|');
    const elId = Number(key.slice(0, sep));
    const typeName = key.slice(sep + 1);
    const colon = typeName.indexOf(':');
    const type = typeName.slice(0, colon);
    const name = typeName.slice(colon + 1);

    const el = elements.get(elId);
    if (!el) continue;

    const slot = slotStates.get(elId)?.get(typeName);
    if (!slot) continue;

    const value = computeAddEventValue(slot);
    if (sameRef(value, slot.installed)) continue;

    // Lynx PAPI: undefined as the 4th arg unregisters.
    __AddEvent(el, type, name, value as string | undefined);
    slot.installed = value;
  }
  dirtySlots.clear();
}

function sameRef(a: unknown, b: unknown): boolean {
  // Reference equality is enough for our usage:
  //  - undefined === undefined
  //  - bgSign string deduplicated by event-registry, so identity stable
  //  - worklet ctx is a fresh object per SET_WORKLET_EVENT op (never compared
  //    to itself across batches because the prev value would always differ),
  //    so this is mostly a defensive no-op for the first three branches.
  return a === b;
}

/**
 * Drop all slot state for one element (snapshot-instance teardown — the
 * synthetic id is about to leave the `elements` map, so pending dirty
 * entries would no-op but the per-element map would leak).
 */
export function clearElementSlots(elId: number): void {
  if (!slotStates.delete(elId)) return;
  const prefix = `${elId}|`;
  for (const key of dirtySlots) {
    if (key.startsWith(prefix)) dirtySlots.delete(key);
  }
}

/** Hot-reload / test reset hook — clears all slot state. */
export function resetSlotStates(): void {
  slotStates.clear();
  dirtySlots.clear();
}
