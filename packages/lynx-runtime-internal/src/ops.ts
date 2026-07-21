/**
 * Flat-array operation codes — the wire protocol between BG Thread and Main Thread.
 *
 * Format (all numbers/strings, JSON-serializable):
 *   CREATE:            [0, id, type]
 *   CREATE_TEXT:       [1, id]
 *   INSERT:            [2, parentId, childId, anchorId]   anchorId=-1 means append
 *   REMOVE:            [3, parentId, childId]
 *   SET_PROP:          [4, id, key, value]
 *   SET_TEXT:          [5, id, text]
 *   SET_EVENT:         [6, id, eventType, eventName, sign]
 *   REMOVE_EVENT:      [7, id, eventType, eventName]
 *   SET_STYLE:         [8, id, styleObject]
 *   SET_CLASS:         [9, id, classString]
 *   SET_ID:            [10, id, idString]
 *   SET_WORKLET_EVENT: [11, id, eventType, eventName, workletCtx]
 *   SET_MT_REF:        [12, id, refImpl]
 *   INIT_MT_REF:       [13, wvid, initValue]
 *   RELEASE_MT_REF:    [14, wvid]
 *   REGISTER_AV_BRIDGE:        [15, wvid, initValue]
 *   UNREGISTER_AV_BRIDGE:      [16, wvid]
 *   REGISTER_AV_STYLE_BINDING: [17, bindingId, elementWvid, avWvid, mapperName, params]
 *   UNREGISTER_AV_STYLE_BINDING: [18, bindingId]
 *   SET_GESTURE_DETECTOR:    [19, elementId, gestureId, type, config, relationMap]
 *   REMOVE_GESTURE_DETECTOR: [20, elementId, gestureId]
 *   INVOKE_UI_METHOD:        [21, id, methodName, params]   fire-and-forget native UI method
 *
 * Snapshot-template ops (#620 — compiled subtrees instantiate on the MT;
 * see @sigx/lynx-runtime-internal/snapshot for the template contract):
 *   SNAPSHOT_CREATE:     [22, id, templateId]        stage an instance (lazy — no elements yet)
 *   SNAPSHOT_SET_VALUES: [23, id, values[]]          full dynamic-hole payload (one wire slot)
 *   SNAPSHOT_SET_VALUE:  [24, id, holeIndex, value]  hole-granular patch
 *   SNAPSHOT_BIND_SLOT:  [25, snapshotId, slotIndex, slotElId]
 *                        register slot slotIndex's host element under slotElId
 *                        so slot children flow through ordinary INSERT/REMOVE
 *
 * Snapshot instances share the element id namespace: their roots and slot
 * targets register in the MT `elements` map, so INSERT/REMOVE/SET_EVENT/
 * SET_MT_REF/gesture ops address template-built trees exactly like op-built
 * ones. There is deliberately no SNAPSHOT_REMOVE — REMOVE tears instances
 * down.
 *
 * Cross-thread dispatch (#688 — `runOnMainThread` rides the SAME ordered
 * stream as registrations, so a dispatch enqueued after a mount's
 * INIT_MT_REF/SET_MT_REF ops can never apply before them; the op-queue's
 * microtask flush also makes timer-context dispatches prompt without a
 * render):
 *   INVOKE_WORKLET: [26, wkltId, args[], captured|null]
 *
 * Derived shared values (#710 — a SharedValue computed on the MT from one or
 * more source SharedValues via a NAMED reducer, recomputed each flush a
 * source changed, BEFORE style bindings apply, so a `useAnimatedStyle` bound
 * to the derived SV sees the fresh value the same frame; the derived SV is
 * itself an auto-flushing bridge, so its result also publishes to BG):
 *   REGISTER_AV_DERIVED:   [27, derivedWvid, reducerName, params, sourceWvids[]]
 *                          re-registering the same derivedWvid replaces its
 *                          reducer/params/sources (reactive factor rebind)
 *   UNREGISTER_AV_DERIVED: [28, derivedWvid]
 */
export const OP = {
  CREATE: 0,
  CREATE_TEXT: 1,
  INSERT: 2,
  REMOVE: 3,
  SET_PROP: 4,
  SET_TEXT: 5,
  SET_EVENT: 6,
  REMOVE_EVENT: 7,
  SET_STYLE: 8,
  SET_CLASS: 9,
  SET_ID: 10,
  SET_WORKLET_EVENT: 11,
  SET_MT_REF: 12,
  INIT_MT_REF: 13,
  RELEASE_MT_REF: 14,
  REGISTER_AV_BRIDGE: 15,
  UNREGISTER_AV_BRIDGE: 16,
  REGISTER_AV_STYLE_BINDING: 17,
  UNREGISTER_AV_STYLE_BINDING: 18,
  SET_GESTURE_DETECTOR: 19,
  REMOVE_GESTURE_DETECTOR: 20,
  INVOKE_UI_METHOD: 21,
  SNAPSHOT_CREATE: 22,
  SNAPSHOT_SET_VALUES: 23,
  SNAPSHOT_SET_VALUE: 24,
  SNAPSHOT_BIND_SLOT: 25,
  INVOKE_WORKLET: 26,
  REGISTER_AV_DERIVED: 27,
  UNREGISTER_AV_DERIVED: 28,
} as const;

export type OpCode = (typeof OP)[keyof typeof OP];
