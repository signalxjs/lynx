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
} as const;

export type OpCode = (typeof OP)[keyof typeof OP];
