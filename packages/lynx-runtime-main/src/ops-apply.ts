/**
 * Main Thread ops executor.
 *
 * Receives the flat-array ops buffer sent by the Background Thread via
 * callLepusMethod('sigxPatchUpdate', { data: JSON.stringify(ops) }) and applies
 * each operation using Lynx PAPI.
 */

import { OP } from '@sigx/lynx-runtime-internal';

import { processGesture } from './upstream/processGesture.js';
import {
  elements,
  pageUniqueId,
  setPageUniqueId,
} from './element-registry.js';
import { resetWorkletEvents, type WorkletPlaceholder } from './worklet-events.js';
import {
  setSlotBgSign,
  setSlotWorklet,
  flushDirtySlots,
  resetSlotStates,
} from './event-slots.js';
import {
  flushAvBridgePublishes,
  flushAnimatedStyleBindings,
  registerAnimatedStyleBinding,
  unregisterAnimatedStyleBinding,
  resetAnimatedStyleBindings,
} from './animated-bridge-mt.js';
import {
  createListElement,
  destroyListElement,
  flushDirtyLists,
  isListElement,
  listInsertChild,
  listRemoveChild,
  noteListItemProp,
  noteSpikeRowsProp,
  resetListState,
} from './list-mt.js';
import { spikeOpEcho } from './spike-snapshot.js';
import {
  registerWebGesture,
  unregisterWebGesture,
  resetWebGestures,
} from './web-gesture-mt.js';
import { MTElementWrapper } from './mt-element.js';

/**
 * Placeholder element inserted by renderPage() to give the host a non-empty
 * tree immediately, suppressing the "loadCard failed USER_RUNTIME_ERROR"
 * timeout. Removed on the first applyOps() call.
 */
let placeholderParent: MainThreadElement | null = null;
let placeholderEl: MainThreadElement | null = null;

/**
 * SharedValue bridge state — registered wvids and last-published snapshots.
 * The op handlers (`OP.REGISTER_AV_BRIDGE` / `OP.UNREGISTER_AV_BRIDGE` below)
 * mutate these collections; `animated-bridge-mt.ts:flushAvBridgePublishes`
 * reads them on every flush boundary to compute the diff to publish to BG.
 */
export const bridgedAvWvids = new Set<number>();
export const bridgedAvLastValues = new Map<number, unknown>();

/**
 * Gesture-detector tracking — per-element wvid → set of attached gesture ids.
 * Used to drive the `has-react-gesture` setup attribute lifecycle: set on the
 * first SET_GESTURE_DETECTOR for an element, cleared when the last gesture is
 * removed via REMOVE_GESTURE_DETECTOR.
 */
const gesturesByElementWvid = new Map<number, Set<number>>();

/**
 * Last-set BaseGesture tree per element wvid. Vendored upstream
 * `processGesture` takes an `oldGesture` arg to diff against — pass the prior
 * tree so callback updates wire correctly through `onWorkletCtxUpdate`.
 */
const lastTreeByElementWvid = new Map<number, unknown>();

/**
 * elementWvid → elementId mapping populated by SET_MT_REF when a
 * `main-thread:ref` binds to an element. Gesture ops carry the elRef's wvid
 * (set at BG-side useGestureDetector time, before the renderer assigns an
 * element id), so resolution is wvid → elementId → raw MainThreadElement.
 *
 * We deliberately do NOT use `lynxWorkletImpl._refImpl._workletRefMap[wvid].current`:
 * that map stores the upstream-wrapped `Element` class (with `setStyleProperties`
 * etc.) which is what worklets need, but the platform's `__SetAttribute` /
 * `__SetGestureDetector` PAPI expect the raw RefCounted element handle.
 * Passing the wrapper trips the `FiberSetAttribute param 0 should be RefCounted`
 * native error.
 */
const elementIdByWvid = new Map<number, number>();

export function resolveElementByWvid(wvid: number): MainThreadElement | undefined {
  const elementId = elementIdByWvid.get(wvid);
  if (elementId === undefined) return undefined;
  return elements.get(elementId);
}

export function setPlaceholder(parent: MainThreadElement, el: MainThreadElement): void {
  placeholderParent = parent;
  placeholderEl = el;
}

function removePlaceholderOnce(): void {
  if (placeholderEl != null && placeholderParent != null) {
    __RemoveElement(placeholderParent, placeholderEl);
    placeholderParent = null;
    placeholderEl = null;
  }
}

/**
 * Use typed PAPI creators for known element types.
 * Native Lynx may set up type-specific internals (e.g. overflow clipping
 * for View, hardware-accelerated decoding for Image) via the typed functions
 * that the generic __CreateElement does not.
 */
function createTypedElement(
  type: string,
  parentComponentUniqueId: number,
): MainThreadElement {
  switch (type) {
    case 'view':
      return __CreateView(parentComponentUniqueId);
    case 'text':
      return __CreateText(parentComponentUniqueId);
    case 'image':
      return __CreateImage(parentComponentUniqueId);
    case 'scroll-view':
      return __CreateScrollView(parentComponentUniqueId);
    case 'page':
      // The page root is special — it's created once by __CreatePage() in
      // renderPage() and aliased to ShadowElement id=1 in BG. Lynx hosts
      // (e.g. Lynx Go) have no behavior class for a second `page` element
      // and will throw "No BehaviorController defined for class page".
      // If user code wraps content in <page>...</page>, treat it as a
      // transparent <view> on the Main Thread so the tree stays valid.
      return __CreateView(parentComponentUniqueId);
    default:
      return __CreateElement(type, parentComponentUniqueId);
  }
}

export function applyOps(ops: unknown[]): void {
  const len = ops.length;
  if (len === 0) return;

  // On the first real ops batch, remove the placeholder element that
  // renderPage() inserted to suppress the host's USER_RUNTIME_ERROR timeout.
  removePlaceholderOnce();

  // Detect duplicate batch from double BG bundle evaluation.
  // Each __init_card_bundle__ invocation gets a fresh webpack module cache, so
  // ShadowElement.nextId resets to 2, producing the same element IDs.
  // If the first CREATE op targets an ID that already exists in our elements Map,
  // this is a duplicate batch — skip it entirely.
  if (len >= 3 && ops[0] === OP.CREATE) {
    const firstId = ops[1] as number;
    if (elements.has(firstId)) {
      return;
    }
  }

  let i = 0;

  while (i < len) {
    const code = ops[i++] as number;

    switch (code) {
      case OP.CREATE: {
        const id = ops[i++] as number;
        const type = ops[i++] as string;
        let el: MainThreadElement;
        if (type === '__comment') {
          el = __CreateRawText('');
        } else if (type === 'list') {
          // `<list>` is created via __CreateList so its recycler callbacks are
          // registered up front (issue #120). list-mt.ts owns its state.
          el = createListElement(id);
          __SetCSSId([el], 0);
        } else {
          el = createTypedElement(type, pageUniqueId);
          __SetCSSId([el], 0);
        }
        elements.set(id, el);
        if (type !== '__comment') {
          __SetAttribute(el, `sigx-ref-${id}`, 1);
        }
        break;
      }

      case OP.CREATE_TEXT: {
        const id = ops[i++] as number;
        const el = __CreateText(pageUniqueId);
        __SetCSSId([el], 0);
        elements.set(id, el);
        __SetAttribute(el, `sigx-ref-${id}`, 1);
        break;
      }

      case OP.INSERT: {
        const parentId = ops[i++] as number;
        const childId = ops[i++] as number;
        const anchorId = ops[i++] as number;
        // `<list>` children are owned by the recycler — record order instead of
        // appending; native attaches them on demand via componentAtIndex.
        if (isListElement(parentId)) {
          listInsertChild(parentId, childId, anchorId);
          break;
        }
        const parent = elements.get(parentId);
        const child = elements.get(childId);
        if (parent && child) {
          if (anchorId === -1) {
            __AppendElement(parent, child);
          } else {
            const anchor = elements.get(anchorId);
            if (anchor) __InsertElementBefore(parent, child, anchor);
          }
        }
        break;
      }

      case OP.REMOVE: {
        const _parentId = ops[i++] as number;
        const childId = ops[i++] as number;
        if (isListElement(_parentId)) {
          listRemoveChild(_parentId, childId);
          break;
        }
        // Tearing down a `<list>` itself — detach its recycler callbacks first.
        if (isListElement(childId)) destroyListElement(childId);
        const parent = elements.get(_parentId);
        const child = elements.get(childId);
        if (parent && child) {
          __RemoveElement(parent, child);
        }
        break;
      }

      case OP.SET_PROP: {
        const id = ops[i++] as number;
        const key = ops[i++] as string;
        const value = ops[i++];
        // #620 spike marker attrs — consumed on MT, must not reach native.
        if (key === 'spike-snapshot-rows' && noteSpikeRowsProp(id, value)) break;
        if (key === 'spike-op-echo') {
          spikeOpEcho(value);
          break;
        }
        const el = elements.get(id);
        if (el) __SetAttribute(el, key, value);
        // Mirror `<list-item>` platform-info props (item-key, full-span, …)
        // into the list's update-list-info metadata (no-op for other keys).
        noteListItemProp(id, key, value);
        break;
      }

      case OP.SET_TEXT: {
        const id = ops[i++] as number;
        const text = ops[i++] as string;
        const el = elements.get(id);
        if (el) __SetAttribute(el, 'text', text);
        break;
      }

      case OP.INVOKE_UI_METHOD: {
        const id = ops[i++] as number;
        const method = ops[i++] as string;
        const rawParams = ops[i++];
        // The ops array is decoded wire data — coerce anything that isn't a
        // plain key/value object (null, primitives, arrays) to {} rather
        // than letting the host widget crash on it.
        const params = rawParams !== null
            && typeof rawParams === 'object'
            && !Array.isArray(rawParams)
          ? rawParams as Record<string, unknown>
          : {};
        const el = elements.get(id);
        // Fire-and-forget: used for imperative element state that attributes
        // can't reach (e.g. <input> setValue after the user has edited the
        // field — the value attribute is initial-only there, see #143).
        // Failures (method unknown to the host widget, element not yet
        // attached) are intentionally swallowed — there is no BG-side caller
        // awaiting a result. The try/catch covers hosts that throw
        // synchronously instead of reporting via the callback, so one bad
        // invoke can't abort the rest of the ops batch.
        if (el && typeof __InvokeUIMethod === 'function') {
          try {
            __InvokeUIMethod(el, method, params, () => { /* fire-and-forget */ });
          } catch { /* swallow — see above */ }
        }
        break;
      }

      case OP.SET_EVENT: {
        const id = ops[i++] as number;
        const eventType = ops[i++] as string;
        const eventName = ops[i++] as string;
        const sign = ops[i++] as string;
        // Defer __AddEvent to flushDirtySlots (end of batch). When a worklet
        // is also registered for the same slot, the slot machine combines
        // them into a single hybrid registration.
        setSlotBgSign(id, eventType, eventName, sign);
        break;
      }

      case OP.REMOVE_EVENT: {
        const id = ops[i++] as number;
        const eventType = ops[i++] as string;
        const eventName = ops[i++] as string;
        // Clear the BG side of this slot. The MT worklet (if any) survives.
        // No worklet-removal op exists yet (see plan Open items).
        setSlotBgSign(id, eventType, eventName, undefined);
        break;
      }

      case OP.SET_STYLE: {
        const id = ops[i++] as number;
        const value = ops[i++] as string | object;
        const el = elements.get(id);
        if (el) __SetInlineStyles(el, value);
        break;
      }

      case OP.SET_CLASS: {
        const id = ops[i++] as number;
        const cls = ops[i++] as string;
        const el = elements.get(id);
        if (el) __SetClasses(el, cls);
        break;
      }

      case OP.SET_ID: {
        const id = ops[i++] as number;
        const idStr = ops[i++] as string | null | undefined;
        const el = elements.get(id);
        if (el) __SetID(el, idStr ?? undefined);
        break;
      }

      case OP.SET_WORKLET_EVENT: {
        const id = ops[i++] as number;
        const eventType = ops[i++] as string;
        const eventName = ops[i++] as string;
        const ctx = ops[i++] as WorkletPlaceholder;
        if (ctx && ctx._wkltId) {
          (ctx as unknown as Record<string, unknown>)['_workletType'] = 'main-thread';
          // Defer __AddEvent — flushDirtySlots will pick the right shape:
          // worklet-only ({type:'worklet', value: ctx}) when no BG handler
          // shares this slot, or hybrid ctx when one does.
          setSlotWorklet(id, eventType, eventName, ctx);
        }
        break;
      }

      case OP.SET_MT_REF: {
        const id = ops[i++] as number;
        const wvid = ops[i++] as number;
        const el = elements.get(id);
        if (el) {
          // Delegate to upstream's worklet-runtime. updateWorkletRef wraps the
          // element in its own Element class and stores it under _wvid.
          const impl = (globalThis as Record<string, unknown>)['lynxWorkletImpl'] as
            { _refImpl: { _workletRefMap: Record<number, { current: unknown; _wvid: number }>; updateWorkletRef: (refImpl: unknown, el: unknown) => void } } | undefined;
          if (impl?._refImpl) {
            const refMap = impl._refImpl._workletRefMap;
            if (!(wvid in refMap)) {
              refMap[wvid] = { current: null, _wvid: wvid };
            }
            impl._refImpl.updateWorkletRef({ _wvid: wvid }, el);

            // Web (`@lynx-js/web-core`): upstream's worklet element wrapper
            // applies styles via `setProperty`, which web-core's element
            // doesn't implement — it throws. Worklet callbacks (e.g.
            // `Pressable`'s press-down visual) call
            // `ref.current.setStyleProperties(...)` directly, so patch that one
            // method to fall back to a web-safe `MTElementWrapper` (raw
            // `__SetInlineStyles` + debounced flush). Native is untouched: the
            // original path succeeds there, so the fallback never runs.
            if (typeof __SetGestureDetector !== 'function') {
              const slot = refMap[wvid] as {
                current?: {
                  __sigxWebSafe?: boolean;
                  setStyleProperties?: (s: Record<string, string | number>) => void;
                };
              };
              const wrapper = slot?.current;
              if (wrapper && !wrapper.__sigxWebSafe) {
                const safe = new MTElementWrapper(el);
                const orig = typeof wrapper.setStyleProperties === 'function'
                  ? wrapper.setStyleProperties.bind(wrapper)
                  : null;
                try {
                  wrapper.setStyleProperties = (styles) => {
                    if (orig) {
                      try {
                        orig(styles);
                        return;
                      } catch {
                        /* web: wrapper.setProperty missing — fall through */
                      }
                    }
                    safe.setStyleProperties(styles);
                  };
                  wrapper.__sigxWebSafe = true;
                } catch {
                  /* frozen wrapper — degrade to no press visual */
                }
              }
            }
          }
          // Record wvid → raw elementId so SET_GESTURE_DETECTOR can resolve
          // the unwrapped MainThreadElement for `__SetAttribute` /
          // `__SetGestureDetector` (which require RefCounted handles, not
          // upstream's Element wrapper).
          elementIdByWvid.set(wvid, id);
        }
        break;
      }

      case OP.INIT_MT_REF: {
        const wvid = ops[i++] as number;
        const initValue = ops[i++];
        const impl = (globalThis as Record<string, unknown>)['lynxWorkletImpl'] as
          { _refImpl: { _workletRefMap: Record<number, { current: unknown; _wvid: number }> } } | undefined;
        if (impl?._refImpl) {
          const refMap = impl._refImpl._workletRefMap;
          if (!(wvid in refMap)) {
            refMap[wvid] = { current: initValue, _wvid: wvid };
          }
        }
        break;
      }

      case OP.RELEASE_MT_REF: {
        // Owning component unmounted on BG; drop the MT-side holder so the
        // worklet ref map doesn't grow unbounded across navigation. Mirrors
        // upstream's WorkletEvents.releaseWorkletRef path (we don't dispatch
        // upstream's event because we manage the map ourselves via ops).
        const wvid = ops[i++] as number;
        const impl = (globalThis as Record<string, unknown>)['lynxWorkletImpl'] as
          { _refImpl: { _workletRefMap: Record<number, unknown> } } | undefined;
        if (impl?._refImpl) {
          delete impl._refImpl._workletRefMap[wvid];
        }
        elementIdByWvid.delete(wvid);
        break;
      }

      case OP.REGISTER_AV_BRIDGE: {
        const wvid = ops[i++] as number;
        const initValue = ops[i++];
        bridgedAvWvids.add(wvid);
        bridgedAvLastValues.set(wvid, initValue);
        break;
      }

      case OP.UNREGISTER_AV_BRIDGE: {
        const wvid = ops[i++] as number;
        bridgedAvWvids.delete(wvid);
        bridgedAvLastValues.delete(wvid);
        break;
      }

      case OP.REGISTER_AV_STYLE_BINDING: {
        const bindingId = ops[i++] as number;
        const elementWvid = ops[i++] as number;
        const avWvid = ops[i++] as number;
        const mapperName = ops[i++] as string;
        const params = ops[i++];
        registerAnimatedStyleBinding(bindingId, elementWvid, avWvid, mapperName, params);
        break;
      }

      case OP.UNREGISTER_AV_STYLE_BINDING: {
        const bindingId = ops[i++] as number;
        unregisterAnimatedStyleBinding(bindingId);
        break;
      }

      case OP.SET_GESTURE_DETECTOR: {
        // Wire format: [op, wvid, gestureId, type, config, relationMap].
        // We reconstruct upstream's BaseGesture shape and delegate to vendored
        // `processGesture` so the platform-call sequence is byte-for-byte
        // identical to `@lynx-js/react`'s snapshot pipeline. Per-base wire
        // means we register one base per op; processGesture handles the
        // single-base fast path. Composed gestures arrive as multiple ops,
        // each carrying its relationMap.
        const elementWvid = ops[i++] as number;
        const gestureId = ops[i++] as number;
        const type = ops[i++] as number;
        const config = ops[i++] as {
          callbacks: { name: string; callback: Record<string, unknown> }[];
          config?: Record<string, unknown>;
        };
        const relationMap = ops[i++] as {
          waitFor: number[];
          simultaneous: number[];
          continueWith: number[];
        };
        const el = resolveElementByWvid(elementWvid);
        if (!el) break;

        // The gesture-arena PAPI isn't implemented on every host — notably web
        // (`@lynx-js/web-core`, where `__SetGestureDetector` is undefined).
        // There, recognize the gesture on the MT side from web-core's pointer
        // events instead of the native arena. (All operands are already
        // consumed above, so `i` stays aligned for the next op.)
        if (typeof __SetGestureDetector !== 'function') {
          registerWebGesture(el, elementWvid, gestureId, type, config);
          // Track the attachment so REMOVE can tear down the web recognizer,
          // mirroring the native bookkeeping below.
          let webAttached = gesturesByElementWvid.get(elementWvid);
          if (!webAttached) {
            webAttached = new Set();
            gesturesByElementWvid.set(elementWvid, webAttached);
          }
          webAttached.add(gestureId);
          break;
        }

        // Reconstruct callbacks Record from the wire's array shape.
        const callbacksRecord: Record<string, Record<string, unknown>> = {};
        for (const cb of config.callbacks) {
          callbacksRecord[cb.name] = cb.callback;
        }

        // Build a fake BaseGesture: relation arrays are id-stubs `[{id}]`
        // because vendored `getGestureInfo` reads `.id` off each entry to
        // produce the relationMap. The platform never sees these objects.
        const stub = (ids: number[]) => ids.map((id) => ({ id }));
        const fakeBaseGesture = {
          __isSerialized: true as const,
          type,
          id: gestureId,
          callbacks: callbacksRecord,
          waitFor: stub(relationMap.waitFor),
          simultaneousWith: stub(relationMap.simultaneous),
          continueWith: stub(relationMap.continueWith),
          ...(config.config ? { config: config.config } : {}),
        };

        // Phase 2.12.1 bug fix: pass `undefined` as oldGesture, NOT the last
        // tree we saw on this element.
        //
        // Our wire format is one SET_GESTURE_DETECTOR op per BaseGesture.
        // When `<Pressable>` registers `Simultaneous(Tap, LongPress)`, two
        // ops arrive in sequence on the same element. If we pass the previous
        // tree to `processGesture`, its diff path treats the second op as
        // "Tap → LongPress" and emits a `__RemoveGestureDetector` for Tap
        // before installing LongPress. Result: only the last gesture stays
        // registered; all earlier gestures are silently uninstalled.
        //
        // The right model for our wire is additive: each op installs ONE
        // gesture without disturbing siblings. Removal is explicit via the
        // REMOVE_GESTURE_DETECTOR op (emitted from `useGestureDetector`'s
        // unmount cleanup), which calls `__RemoveGestureDetector` directly.
        // Note: this means we don't get diff-based callback updates if the
        // BG side re-emits a gesture with the same id — but our wire never
        // does that today; on prop changes BG emits REMOVE then SET.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        processGesture(el, fakeBaseGesture as any, undefined, false);
        lastTreeByElementWvid.set(elementWvid, fakeBaseGesture);

        // Track for REMOVE op cleanup and to drive `has-react-gesture` toggle
        // when the last gesture goes (vendored function clears it on remove).
        let attached = gesturesByElementWvid.get(elementWvid);
        if (!attached) {
          attached = new Set();
          gesturesByElementWvid.set(elementWvid, attached);
        }
        attached.add(gestureId);
        break;
      }

      case OP.REMOVE_GESTURE_DETECTOR: {
        const elementWvid = ops[i++] as number;
        const gestureId = ops[i++] as number;
        const el = resolveElementByWvid(elementWvid);
        // Web path: tear down the MT recognizer + its touch listeners.
        if (el && typeof __SetGestureDetector !== 'function') {
          unregisterWebGesture(elementWvid, gestureId);
          const attached = gesturesByElementWvid.get(elementWvid);
          if (attached) {
            attached.delete(gestureId);
            if (attached.size === 0) gesturesByElementWvid.delete(elementWvid);
          }
          break;
        }
        if (el && typeof __RemoveGestureDetector === 'function') {
          __RemoveGestureDetector(el, gestureId);
          const attached = gesturesByElementWvid.get(elementWvid);
          if (attached) {
            attached.delete(gestureId);
            if (attached.size === 0) {
              gesturesByElementWvid.delete(elementWvid);
              lastTreeByElementWvid.delete(elementWvid);
              __SetAttribute(el, 'has-react-gesture', null);
            }
          }
        }
        break;
      }

      default:
        // Unknown op – skip (future-compat)
        break;
    }
  }

  // Commit deferred __AddEvent registrations now that the entire batch is
  // processed — this is what lets worklet + BG handler on the same slot
  // coexist via the hybrid worklet ctx, without one overwriting the other.
  flushDirtySlots();

  // Diff registered SharedValues against their last-published snapshots
  // and dispatch a batched Lynx.Sigx.AvPublish event with anything that
  // changed during this op batch. See animated-bridge-mt.ts for details.
  flushAvBridgePublishes();

  // Apply any useAnimatedStyle bindings whose source SharedValue changed
  // during this batch. Runs after flushAvBridgePublishes so the BG mirror
  // stays consistent with the styles we're about to commit.
  flushAnimatedStyleBindings();

  // Emit update-list-info diffs for any `<list>` whose children changed this
  // batch, so native knows its cell count/keys before it lays out.
  flushDirtyLists();

  // Flush all pending PAPI changes to the native layer in one shot.
  __FlushElementTree();
}

/** Reset module state — for testing and hot reload. */
export function resetMainThreadState(): void {
  elements.clear();
  setPageUniqueId(1);
  placeholderParent = null;
  placeholderEl = null;
  // Also defined in this module's imports — reset worklet state
  resetWorkletEvents();
  resetSlotStates();
  bridgedAvWvids.clear();
  bridgedAvLastValues.clear();
  gesturesByElementWvid.clear();
  lastTreeByElementWvid.clear();
  elementIdByWvid.clear();
  resetAnimatedStyleBindings();
  resetListState();
  resetWebGestures();
  // Clear upstream's worklet ref map too on hard reset (HMR / test).
  const impl = (globalThis as Record<string, unknown>)['lynxWorkletImpl'] as
    { _refImpl: { _workletRefMap: Record<number, unknown> } } | undefined;
  if (impl?._refImpl) impl._refImpl._workletRefMap = {};
}
