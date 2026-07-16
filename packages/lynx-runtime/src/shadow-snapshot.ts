/**
 * BG-side shadow nodes for snapshot templates (#630, phase 4a of #620).
 *
 * A `ShadowSnapshotElement` mirrors one compiled-template instance: its id is
 * the instance id the MT stages on SNAPSHOT_CREATE, its `type` is the
 * template uniqID string. Dynamic-hole state lives here — the last WIRE
 * values pushed (the diff baseline for SNAPSHOT_SET_VALUE) plus the sign /
 * worklet bookkeeping that keeps re-renders op-free when only handler
 * closures changed.
 *
 * A `ShadowSlotElement` is the synthetic host the jsx wrapper mints for each
 * `$N` slot prop. It emits NO create op — on the MT it aliases an element
 * INSIDE the template (registered by SNAPSHOT_BIND_SLOT). Until the slot
 * binds (i.e. until it inserts into its snapshot parent), child INSERTs stay
 * shadow-only and replay after the bind — the mount order (children mount
 * before the slot itself inserts) makes this deferral mandatory.
 */

import { ShadowElement } from './shadow-element.js';

export class ShadowSnapshotElement extends ShadowElement {
  /** Last wire values pushed (SNAPSHOT_SET_VALUES/SET_VALUE diff baseline). */
  wireValues: unknown[] = [];
  /** hole key ('2' or '2:bindtap' inside spreads) → BG event-registry sign. */
  holeSigns: Map<string, string> = new Map();
  /** hole key → last _wkltId shipped (skip re-registering unchanged worklets). */
  sentWorkletIds: Map<string, string> = new Map();
}

export class ShadowSlotElement extends ShadowElement {
  /** Which template slot this element aliases; set via the __slotIndex prop. */
  slotIndex = -1;
  /** True once SNAPSHOT_BIND_SLOT has been emitted for this element. */
  bound = false;

  constructor() {
    super('__sigx-slot');
  }
}

export function isShadowSnapshotElement(el: ShadowElement): el is ShadowSnapshotElement {
  return el instanceof ShadowSnapshotElement;
}

export function isShadowSlotElement(el: ShadowElement): el is ShadowSlotElement {
  return el instanceof ShadowSlotElement;
}
