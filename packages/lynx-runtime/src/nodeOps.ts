/**
 * Lynx renderer node operations (Background Thread).
 *
 * Builds a ShadowElement tree and pushes ops into the op queue. NO Lynx PAPI
 * globals (__CreateElement, __AppendElement, etc.) are referenced here — those
 * only exist on the Main Thread. The op queue is flushed to MT via
 * sigxPatchUpdate, where ops-apply.ts dispatches them to real PAPI calls.
 */
import type { RendererOptions } from '@sigx/runtime-core/internals';
import { isSnapshotType } from '@sigx/lynx-runtime-internal/snapshot';
import { OP, pushOp, scheduleFlush } from './op-queue.js';
import { register, unregister } from './event-registry.js';
import { ShadowElement } from './shadow-element.js';
import {
  ShadowSlotElement,
  ShadowSnapshotElement,
  isShadowSlotElement,
  isShadowSnapshotElement,
} from './shadow-snapshot.js';
import { normalizeHole, releaseHoleValues, wireEqual } from './snapshot-values.js';
import { registerWorkletCtx } from './run-on-background.js';
import {
  patchDirective as runDirective,
  onElementMounted as runDirectiveMounted,
  onElementUnmounted as runDirectiveUnmounted,
} from './directives/index.js';

// ---------------------------------------------------------------------------
// Re-export ShadowElement as the HostNode / HostElement type
// ---------------------------------------------------------------------------

export type LynxNode = ShadowElement;
export type LynxElement = ShadowElement;

// ---------------------------------------------------------------------------
// Event prop classification
// ---------------------------------------------------------------------------

interface EventSpec {
  type: string;
  name: string;
  /** When true, this event runs on the Main Thread (zero-latency). */
  mainThread?: boolean;
}

function parseEventProp(key: string): EventSpec | null {
  // Main-thread event prefixes: main-thread-bind*, main-thread-catch*
  if (key.startsWith('main-thread-bind')) {
    return { type: 'bindEvent', name: key.slice('main-thread-bind'.length), mainThread: true };
  }
  if (key.startsWith('main-thread-catch')) {
    return { type: 'catchEvent', name: key.slice('main-thread-catch'.length), mainThread: true };
  }
  // Alternative syntax: main-thread:bind*, main-thread:catch*
  if (key.startsWith('main-thread:bind')) {
    return { type: 'bindEvent', name: key.slice('main-thread:bind'.length), mainThread: true };
  }
  if (key.startsWith('main-thread:catch')) {
    return { type: 'catchEvent', name: key.slice('main-thread:catch'.length), mainThread: true };
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
  if (/^on[A-Z]/.test(key)) {
    // onTap → { type: 'bindEvent', name: 'tap' }
    const name = key.slice(2, 3).toLowerCase() + key.slice(3);
    return { type: 'bindEvent', name };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Worklet placeholder detection — @lynx-js/react/transform replaces
// 'main thread' functions with { _wkltId, _c? } placeholders in the BG bundle.
// ---------------------------------------------------------------------------

import { MainThreadRef, sanitizeCaptured } from './main-thread-ref.js';

interface WorkletPlaceholder {
  _wkltId: string;
  _c?: Record<string, unknown>;
  _jsFn?: Record<string, unknown>;
}

function isWorkletPlaceholder(v: unknown): v is WorkletPlaceholder {
  return typeof v === 'object' && v !== null && '_wkltId' in (v as object);
}

// Track sent worklet ids per (elementId, propKey) to skip redundant ops on re-render.
const sentWorklets = new Map<number, Map<string, string>>();

// Track the sign registered for each (element, propKey) so we can unregister
// on prop removal / update.
const elementEventSigns = new Map<number, Map<string, string>>();

// Track which sign owns the native event slot per (elementId, 'eventType:eventName').
// Lynx only supports one __AddEvent per (element, eventType, eventName). When multiple
// props resolve to the same native event (e.g. main-thread-bindtap + bindtap both map
// to bindEvent:tap), we keep one sign in __AddEvent and dispatch to all handlers from
// a multi-handler wrapper in the BG registry.
const nativeEventSlots = new Map<number, Map<string, { sign: string; handlers: Map<string, (data: unknown) => void> }>>();

// <input>/<textarea> elements whose non-empty initial value was captured at
// mount (`el.parent == null`, before insertion). The `value` attribute set at
// mount is honored by Android but ignored by iOS for initial display, and a
// `setValue` UI method invoked in the mount batch is dropped too — the native
// iOS input view isn't laid out yet. So the value is (re)applied via setValue
// on a short deferred tick, once the view exists, which makes the model-bound
// prefill appear on iOS while staying a harmless no-op repeat on Android. (#404)
const pendingInitialValues = new Set<ShadowElement>();
let initialValueFlushScheduled = false;

// Delay before the deferred setValue. Long enough for the first native layout
// pass (the input view must exist for setValue to take effect), short enough to
// be barely perceptible. Post-mount programmatic value changes don't need this
// (the field is already laid out) and go through patchProp's immediate path.
const INITIAL_VALUE_SYNC_DELAY_MS = 50;

/**
 * Emit a deferred `setValue` for each input/textarea that captured a non-empty
 * initial value at mount, seeding `_lastInputValue` so the first
 * model-echo/programmatic comparison is correct. Exported for tests (which
 * drive it directly instead of waiting on the timer).
 */
export function flushPendingInitialValues(): void {
  initialValueFlushScheduled = false;
  if (pendingInitialValues.size === 0) return;
  let emitted = false;
  for (const el of pendingInitialValues) {
    const v = el._pendingInitialValue;
    el._pendingInitialValue = undefined;
    // Skip when:
    //  - removed/detached before the timer fired (`parent == null`) — the
    //    native node is gone, so setValue would target nothing; or
    //  - the field already has known content (`_lastInputValue` set by a
    //    bindinput event from the user typing, or by a programmatic write)
    //    during the deferral window — re-applying the initial value would
    //    clobber what's there.
    if (v != null && el.parent != null && el._lastInputValue === undefined) {
      pushOp(OP.INVOKE_UI_METHOD, el.id, 'setValue', { value: v });
      el._lastInputValue = v;
      emitted = true;
    }
  }
  pendingInitialValues.clear();
  if (emitted) scheduleFlush();
}

/** Register an input/textarea for a deferred initial-value setValue (coalesced). */
function scheduleInitialValueSync(el: ShadowElement): void {
  pendingInitialValues.add(el);
  if (initialValueFlushScheduled) return;
  initialValueFlushScheduled = true;
  setTimeout(flushPendingInitialValues, INITIAL_VALUE_SYNC_DELAY_MS);
}

/**
 * Test-only: clear the module-level per-element maps above. They are keyed by
 * element id, so a test suite that recycles ids via `resetShadowState()`
 * without this reset would resolve stale slots from earlier tests (and skip
 * pushing SET_EVENT for "already registered" events). Production code never
 * recycles ids, so this is never called outside tests.
 */
export function resetNodeOpsState(): void {
  sentWorklets.clear();
  elementEventSigns.clear();
  nativeEventSlots.clear();
  pendingInitialValues.clear();
  initialValueFlushScheduled = false;
}

// ---------------------------------------------------------------------------
// Style normalisation — numeric values → 'Npx' (Lynx requires units)
// ---------------------------------------------------------------------------

const DIMENSIONLESS = new Set([
  'flex',
  'flexGrow',
  'flexShrink',
  'flexOrder',
  'order',
  'opacity',
  'zIndex',
  'aspectRatio',
  'fontWeight',
  'lineClamp',
]);

/**
 * Expand the CSS `flex` shorthand into its longhands. The native
 * inline-style path does not expand shorthands (the stylesheet path does),
 * so a raw `flex: 1` reaches the engine as an unknown property and the
 * element silently gets no flex sizing at all (#264). CSS semantics:
 *
 *   flex: 2              → grow 2, shrink 1, basis 0%
 *   flex: 'none'         → grow 0, shrink 0, basis auto
 *   flex: 'auto'         → grow 1, shrink 1, basis auto
 *   flex: 'initial'      → grow 0, shrink 1, basis auto
 *   flex: '200px'        → grow 1, shrink 1, basis 200px
 *   flex: '2 3'          → grow 2, shrink 3, basis 0%
 *   flex: '2 200px'      → grow 2, shrink 1, basis 200px
 *   flex: '2 3 200px'    → grow 2, shrink 3, basis 200px
 *
 * Returns null for values it can't make sense of (passed through as-is) —
 * including non-finite or negative grow/shrink (invalid per CSS) and
 * empty/whitespace-only strings.
 */
function expandFlexShorthand(
  val: unknown,
): { flexGrow: number; flexShrink: number; flexBasis: string } | null {
  // CSS: grow/shrink must be finite and non-negative.
  const factor = (raw: unknown): number | null => {
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  if (typeof val === 'number') {
    const grow = factor(val);
    return grow === null ? null : { flexGrow: grow, flexShrink: 1, flexBasis: '0%' };
  }
  if (typeof val !== 'string' || val.trim() === '') return null;
  const tokens = val.trim().split(/\s+/);
  if (tokens.length === 1) {
    const t = tokens[0];
    if (t === 'none') return { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' };
    if (t === 'auto') return { flexGrow: 1, flexShrink: 1, flexBasis: 'auto' };
    if (t === 'initial') return { flexGrow: 0, flexShrink: 1, flexBasis: 'auto' };
    const grow = factor(t);
    if (grow !== null) return { flexGrow: grow, flexShrink: 1, flexBasis: '0%' };
    // Not numeric-ish at all → single <flex-basis>; numeric-but-invalid
    // ('-1', 'Infinity') → unparseable, pass through.
    return Number.isNaN(Number(t))
      ? { flexGrow: 1, flexShrink: 1, flexBasis: t }
      : null;
  }
  if (tokens.length === 2) {
    const grow = factor(tokens[0]);
    if (grow === null) return null;
    if (Number.isNaN(Number(tokens[1]))) {
      return { flexGrow: grow, flexShrink: 1, flexBasis: tokens[1] };
    }
    const shrink = factor(tokens[1]);
    return shrink === null ? null : { flexGrow: grow, flexShrink: shrink, flexBasis: '0%' };
  }
  if (tokens.length === 3) {
    const grow = factor(tokens[0]);
    const shrink = factor(tokens[1]);
    if (grow === null || shrink === null) return null;
    return { flexGrow: grow, flexShrink: shrink, flexBasis: tokens[2] };
  }
  return null;
}

function normalizeStyle(
  style: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(style)) {
    const val = style[key];
    if (key === 'flex') {
      const expanded = expandFlexShorthand(val);
      if (expanded) {
        // Insertion order preserves CSS override semantics: an explicit
        // longhand written *after* `flex` in the style object overwrites
        // the expansion; one written before is overridden by it.
        out.flexGrow = expanded.flexGrow;
        out.flexShrink = expanded.flexShrink;
        out.flexBasis = expanded.flexBasis;
        continue;
      }
    }
    if (typeof val === 'number' && !DIMENSIONLESS.has(key) && val !== 0) {
      out[key] = `${val}px`;
    } else {
      out[key] = val;
    }
  }
  return out;
}

function shallowEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Class resolution — merges user :class with transition classes
// ---------------------------------------------------------------------------

export function resolveClass(el: ShadowElement): string {
  if (el._transitionClasses.size === 0) return el._baseClass;
  const parts: string[] = [];
  if (el._baseClass) parts.push(el._baseClass);
  for (const cls of el._transitionClasses) parts.push(cls);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Style application — merges the raw user style with the `show` visibility
// override and emits a deduped SET_STYLE op
// ---------------------------------------------------------------------------

/**
 * Push a SET_STYLE op for an element's *effective* style — its raw user style
 * (`el._style`) merged with `display:none` when hidden by the `show` directive
 * (`el._vShowHidden`). Deduped against the last effective style actually sent
 * (`el._lastPushedStyle`), not the raw style, so:
 *   - a hidden element does not re-emit `display:none` on every re-render, and
 *   - toggling `show` back on re-emits the raw style (removing `display:none`).
 * Re-emitting only on a real change also preserves any MT worklet
 * `setStyleProperties` writes (tap scale/colour, etc.) from being clobbered.
 */
function applyElementStyle(el: ShadowElement): void {
  const effective = el._vShowHidden
    ? { ...el._style, display: 'none' }
    : el._style;
  const prev = el._lastPushedStyle;
  if (prev != null) {
    if (shallowEqual(prev, effective)) return;
  } else if (Object.keys(effective).length === 0) {
    // Nothing pushed yet and nothing to push — don't emit an empty SET_STYLE.
    return;
  }
  el._lastPushedStyle = effective;
  pushOp(OP.SET_STYLE, el.id, effective);
  scheduleFlush();
}

/**
 * Set an element's visibility for the `show` directive: flip the vShow flag and
 * re-emit the (deduped) effective style. Exported for `directives/show.ts`.
 */
export function applyElementVisibility(el: ShadowElement, visible: boolean): void {
  el._vShowHidden = !visible;
  applyElementStyle(el);
}

// ---------------------------------------------------------------------------
// RendererOptions implementation
// ---------------------------------------------------------------------------

/**
 * Diff a snapshot instance's dynamic-hole values at the WIRE level: mount
 * pushes one SNAPSHOT_SET_VALUES; re-renders push SNAPSHOT_SET_VALUE only for
 * holes whose normalized form changed. Handler-only changes are op-free by
 * construction (stable signs — see snapshot-values.ts).
 */
function patchSnapshotValues(el: ShadowSnapshotElement, nextValue: unknown): void {
  const values = Array.isArray(nextValue) ? nextValue : [];
  const first = el.wireValues.length === 0 && values.length > 0;
  if (first) {
    const wire = values.map((v, i) => normalizeHole(el, i, v));
    el.wireValues = wire;
    pushOp(OP.SNAPSHOT_SET_VALUES, el.id, wire);
    scheduleFlush();
    return;
  }
  let emitted = false;
  const max = Math.max(values.length, el.wireValues.length);
  for (let i = 0; i < max; i++) {
    const wire = i < values.length ? normalizeHole(el, i, values[i]) : undefined;
    if (!wireEqual(wire, el.wireValues[i])) {
      el.wireValues[i] = wire;
      pushOp(OP.SNAPSHOT_SET_VALUE, el.id, i, wire);
      emitted = true;
    }
  }
  el.wireValues.length = values.length;
  if (emitted) scheduleFlush();
}

/** Release event signs for every snapshot instance in a detached subtree. */
function releaseSnapshotSigns(root: ShadowElement): void {
  if (isShadowSnapshotElement(root)) releaseHoleValues(root);
  for (let c = root.firstChild; c; c = c.next) {
    releaseSnapshotSigns(c);
  }
}

export const nodeOps: RendererOptions<ShadowElement, ShadowElement> = {
  createElement(type: string): ShadowElement {
    // Snapshot templates (#620): the id becomes a staged MT instance; slots
    // are synthetic (they alias template-inner elements via SNAPSHOT_BIND_SLOT
    // at insert time, so no create op at all).
    if (type === '__sigx-slot') {
      return new ShadowSlotElement();
    }
    if (isSnapshotType(type)) {
      const el = new ShadowSnapshotElement(type);
      pushOp(OP.SNAPSHOT_CREATE, el.id, type);
      scheduleFlush();
      return el;
    }
    const el = new ShadowElement(type);
    pushOp(OP.CREATE, el.id, type);
    scheduleFlush();
    return el;
  },

  createText(text: string): ShadowElement {
    const el = new ShadowElement('#text');
    pushOp(OP.CREATE_TEXT, el.id);
    if (text) pushOp(OP.SET_TEXT, el.id, text);
    scheduleFlush();
    return el;
  },

  // Comment nodes are used as position anchors for conditionals / Fragment.
  // Materialised as invisible placeholder elements on the Main Thread.
  createComment(_text: string): ShadowElement {
    const el = new ShadowElement('#comment');
    pushOp(OP.CREATE, el.id, '__comment');
    scheduleFlush();
    return el;
  },

  setText(node: ShadowElement, text: string): void {
    pushOp(OP.SET_TEXT, node.id, text);
    scheduleFlush();
  },

  setElementText(el: ShadowElement, text: string): void {
    // Remove all children from shadow tree
    while (el.firstChild) {
      const child = el.firstChild;
      el.removeChild(child);
      pushOp(OP.REMOVE, el.id, child.id);
    }
    // Set text content directly on the element
    pushOp(OP.SET_TEXT, el.id, text);
    scheduleFlush();
  },

  insert(
    child: ShadowElement,
    parent: ShadowElement,
    anchor?: ShadowElement | null,
  ): void {
    // Always update the shadow tree (the core renderer needs sync tree queries).
    parent.insertBefore(child, anchor ?? null);

    // Snapshot slots (#620): children mount into the slot BEFORE the slot
    // inserts into its snapshot parent, so their INSERTs defer (the MT has no
    // element for the slot id yet). The slot's own insert emits
    // SNAPSHOT_BIND_SLOT — registering the aliased template element under the
    // slot id — then replays the deferred child inserts in shadow order.
    if (isShadowSlotElement(parent) && !parent.bound) {
      return;
    }
    if (isShadowSlotElement(child)) {
      // Bind exactly once (a keyed-diff MOVE re-inserts the same slot — a
      // second bind would replay child INSERTs and duplicate MT children)
      // and only with a valid slot index.
      if (
        isShadowSnapshotElement(parent)
        && !child.bound
        && Number.isInteger(child.slotIndex)
        && child.slotIndex >= 0
      ) {
        pushOp(OP.SNAPSHOT_BIND_SLOT, parent.id, child.slotIndex, child.id);
        child.bound = true;
        for (let c = child.firstChild; c; c = c.next) {
          pushOp(OP.INSERT, child.id, c.id, -1);
        }
        scheduleFlush();
      }
      // A slot outside a snapshot parent is a transform-contract violation;
      // stay silent on the wire (the MT can't resolve it anyway).
      return;
    }

    // Lynx's native <list> only accepts <list-item> children.
    // Skip comment/text anchors to avoid NSInvalidArgumentException.
    if (
      parent.type === 'list'
      && (child.type === '#comment' || child.type === '#text')
    ) {
      return;
    }

    // If the anchor is a comment node inside a <list>, walk forward to find
    // the next real sibling so the MT __InsertElementBefore has a valid ref.
    let resolvedAnchor: ShadowElement | null = anchor ?? null;
    if (parent.type === 'list') {
      while (
        resolvedAnchor
        && (resolvedAnchor.type === '#comment'
          || resolvedAnchor.type === '#text')
      ) {
        resolvedAnchor = resolvedAnchor.next;
      }
    }

    const anchorId = resolvedAnchor ? resolvedAnchor.id : -1;
    pushOp(OP.INSERT, parent.id, child.id, anchorId);
    scheduleFlush();
  },

  remove(child: ShadowElement): void {
    if (child.parent) {
      const parentId = child.parent.id;
      // Shadow-only removals — no wire op:
      //  - children of a never-bound slot never reached the MT tree;
      //  - a bound slot itself ALIASES a template-inner element on the MT
      //    (registered via SNAPSHOT_BIND_SLOT); REMOVE(snapshotId, slotId)
      //    would name the wrong parent and detach template structure. The
      //    alias entry dies with the instance's teardown.
      const shadowOnly = (isShadowSlotElement(child.parent) && !child.parent.bound)
        || isShadowSlotElement(child);
      // A bound slot's inserted children are real MT elements inside the
      // aliased template element — detach each explicitly before the slot
      // itself vanishes shadow-only.
      if (isShadowSlotElement(child) && child.bound) {
        for (let c = child.firstChild; c; c = c.next) {
          pushOp(OP.REMOVE, child.id, c.id);
        }
        scheduleFlush();
      }
      child.parent.removeChild(child);
      // The subtree may contain snapshot instances (directly or inside slot
      // content) whose event signs must not outlive their elements.
      releaseSnapshotSigns(child);
      if (!shadowOnly) {
        pushOp(OP.REMOVE, parentId, child.id);
        scheduleFlush();
      }
    }
  },

  patchProp(
    el: ShadowElement,
    key: string,
    _prevValue: unknown,
    nextValue: unknown,
  ): void {
    // Snapshot templates (#620): the only live props are the values array
    // (per-hole wire diffing) and the slot index; everything else on these
    // synthetic elements is compile-time metadata.
    if (isShadowSnapshotElement(el)) {
      if (key === 'values') patchSnapshotValues(el, nextValue);
      return;
    }
    if (isShadowSlotElement(el)) {
      // slotIndex feeds SNAPSHOT_BIND_SLOT routing — reject anything but a
      // non-negative integer (leave unset; the bind guard skips it).
      if (key === '__slotIndex') {
        const n = Number(nextValue);
        if (Number.isInteger(n) && n >= 0) el.slotIndex = n;
      }
      return;
    }

    // Handle main-thread:ref — bind a MainThreadRef to this element
    if (key === 'main-thread:ref') {
      if (nextValue != null) {
        const mtRef = nextValue as MainThreadRef;
        pushOp(OP.SET_MT_REF, el.id, mtRef._wvid);
      }
      scheduleFlush();
      return;
    }

    const event = parseEventProp(key);

    if (event) {
      // Worklet placeholders ({ _wkltId, _c? }) emitted by @lynx-js/react/transform
      // bypass the BG event-registry path entirely — the MT side dispatches.
      if (event.mainThread && nextValue != null && isWorkletPlaceholder(nextValue)) {
        let elWorklets = sentWorklets.get(el.id);
        const prevId = elWorklets?.get(key);
        if (prevId !== nextValue._wkltId) {
          if (!elWorklets) {
            elWorklets = new Map();
            sentWorklets.set(el.id, elWorklets);
          }
          elWorklets.set(key, nextValue._wkltId);
          const wireCtx: {
            _wkltId: string;
            _c?: Record<string, unknown>;
            _jsFn?: Record<string, unknown>;
            _execId?: number;
          } = {
            _wkltId: nextValue._wkltId,
          };
          if (nextValue._c) wireCtx._c = sanitizeCaptured(nextValue._c);
          if (nextValue._jsFn) wireCtx._jsFn = nextValue._jsFn;
          // Stamp _execId so MT can route runOnBackground dispatches back
          // to the JsFnHandles inside _jsFn / _c.
          registerWorkletCtx(wireCtx);
          pushOp(OP.SET_WORKLET_EVENT, el.id, event.type, event.name, wireCtx);
          scheduleFlush();
        }
        return;
      }

      let propSigns = elementEventSigns.get(el.id);
      const nativeKey = `${event.type}:${event.name}`;

      if (nextValue != null) {
        const handler = nextValue as (data: unknown) => void;

        // Get or create the native event slot for this (element, eventType, eventName).
        let elSlots = nativeEventSlots.get(el.id);
        if (!elSlots) {
          elSlots = new Map();
          nativeEventSlots.set(el.id, elSlots);
        }

        let slot = elSlots.get(nativeKey);
        if (!slot) {
          // Record what the user typed so the `value` patch branch below can
          // tell a model echo apart from a programmatic write (#143).
          const trackInputValue = event.name === 'input'
            && (el.type === 'input' || el.type === 'textarea');
          // First handler for this native event — register with Lynx.
          const sign = register((data: unknown) => {
            if (trackInputValue) {
              const v = (data as { detail?: { value?: unknown } })?.detail?.value;
              // Normalize to a string ('' for nullish) — the `value` patch
              // branch compares and stores the same representation, and
              // setValue only ever pushes strings.
              el._lastInputValue = v == null ? '' : String(v);
            }
            // Dispatch to all handlers registered for this slot.
            const s = elSlots!.get(nativeKey);
            if (s) {
              for (const h of s.handlers.values()) h(data);
            }
          });
          slot = { sign, handlers: new Map() };
          elSlots.set(nativeKey, slot);
          pushOp(OP.SET_EVENT, el.id, event.type, event.name, sign);
        }

        // Add/update this prop's handler in the slot.
        slot.handlers.set(key, handler);

        // Track prop→sign for re-render updates.
        if (!propSigns) {
          propSigns = new Map<string, string>();
          elementEventSigns.set(el.id, propSigns);
        }
        propSigns.set(key, slot.sign);
      } else {
        // Handler removed.
        const elSlots = nativeEventSlots.get(el.id);
        const slot = elSlots?.get(nativeKey);
        if (slot) {
          slot.handlers.delete(key);
          if (slot.handlers.size === 0) {
            // No more handlers — unregister from Lynx.
            unregister(slot.sign);
            elSlots!.delete(nativeKey);
            pushOp(OP.REMOVE_EVENT, el.id, event.type, event.name);
          }
        }
        propSigns?.delete(key);
      }
    } else if (key === 'style') {
      // Cache the raw normalized style, then emit the effective (deduped) op.
      // JSX inline `style={{...}}` makes a fresh object every render but its
      // keys/values usually don't change; applyElementStyle skips unchanged
      // ops so MT worklet setStyleProperties writes aren't clobbered.
      el._style = nextValue != null && typeof nextValue === 'object'
        ? normalizeStyle(nextValue as Record<string, unknown>)
        : {};
      applyElementStyle(el);
    } else if (key === 'class') {
      el._baseClass = (nextValue as string) ?? '';
      const finalClass = resolveClass(el);
      pushOp(OP.SET_CLASS, el.id, finalClass);
    } else if (key === 'id') {
      pushOp(OP.SET_ID, el.id, nextValue);
    } else if (key === 'value' && (el.type === 'input' || el.type === 'textarea')) {
      pushOp(OP.SET_PROP, el.id, key, nextValue);
      // The native field treats the `value` attribute as initial-only once
      // the user has edited it — programmatic writes (clear-on-send, editor
      // toolbar inserts) must additionally go through the element's
      // `setValue` UI method or the visible text never changes (#143). Also
      // skip the model echo (the re-render caused by the user's own typing,
      // where the new value is exactly what the input event just reported) so
      // cursor/IME composition isn't disturbed while typing.
      // Normalize to a string ('' for nullish) on BOTH sides of the
      // comparison — `value` is typed string on input/textarea but user code
      // can write a number/boolean by mistake, and setValue is a native
      // text-field method that expects a string. Any other representation
      // would desync `_lastInputValue` from the native field and re-invoke
      // redundantly on later renders.
      const next = nextValue == null ? '' : String(nextValue);
      if (el.parent != null) {
        if (el._pendingInitialValue !== undefined && next === el._pendingInitialValue) {
          // An (unrelated) re-render re-patched the same initial value before
          // the deferred sync fired. Leave the deferral to apply it after the
          // view is laid out — emitting now would be the iOS-too-early setValue
          // the deferral exists to avoid. Keep pending; don't touch
          // _lastInputValue. (#404)
        } else {
          // A post-mount value *change* supersedes any not-yet-flushed initial
          // value, so the deferred setValue can't later clobber it (#404).
          if (el._pendingInitialValue !== undefined) {
            el._pendingInitialValue = undefined;
            pendingInitialValues.delete(el);
          }
          if (next !== el._lastInputValue) {
            pushOp(OP.INVOKE_UI_METHOD, el.id, 'setValue', { value: next });
            // The programmatic write replaces whatever the user had typed;
            // track it so the next echo comparison stays correct.
            el._lastInputValue = next;
          }
        }
      } else if (next !== '') {
        // Initial mount (props patched before insertion): iOS ignores the
        // `value` attribute for initial display and drops a setValue invoked
        // before the input view is laid out, so a model-bound prefill would
        // show only the placeholder. Stash the value and (re)apply it via a
        // short deferred setValue once the view exists. An empty initial value
        // needs nothing extra (the attribute covers it). (#404)
        el._pendingInitialValue = next;
        scheduleInitialValueSync(el);
      } else if (el._pendingInitialValue !== undefined) {
        // Re-patched to empty while still uninserted — supersede the earlier
        // non-empty stash so the deferred setValue can't emit a stale value.
        el._pendingInitialValue = undefined;
        pendingInitialValues.delete(el);
      }
    } else {
      pushOp(OP.SET_PROP, el.id, key, nextValue);
    }
    scheduleFlush();
  },

  parentNode(node: ShadowElement): ShadowElement | null {
    return node.parent;
  },

  nextSibling(node: ShadowElement): ShadowElement | null {
    return node.next;
  },

  cloneNode(node: ShadowElement): ShadowElement {
    // Lynx has no native clone — create a new shadow element of the same type
    const el = new ShadowElement(node.type);
    if (node.type === '#text') {
      pushOp(OP.CREATE_TEXT, el.id);
    } else {
      pushOp(OP.CREATE, el.id, node.type);
    }
    scheduleFlush();
    return el;
  },

  // --- use:* directive lifecycle (created/updated, then mounted/unmounted) ---
  // The renderer calls these for `use:<name>` props and around element
  // insert/remove. Directive hooks may push ops (e.g. `show` emits SET_STYLE),
  // so flush after the create/update paths.

  patchDirective(el, name, prevValue, nextValue, appContext): void {
    runDirective(el, name, prevValue, nextValue, appContext);
    scheduleFlush();
  },

  onElementMounted(el): void {
    runDirectiveMounted(el);
    scheduleFlush();
  },

  onElementUnmounted(el): void {
    runDirectiveUnmounted(el);
  },
};
