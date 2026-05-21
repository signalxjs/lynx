// Copyright 2024 The Lynx Authors. All rights reserved.
// TypeScript types added 2026 by SignalX contributors.
//
// Licensed under the Apache License, Version 2.0. The full license text and
// upstream attribution are reproduced in `THIRD_PARTY_NOTICES.md` at the
// root of this package (`@sigx/lynx-runtime-main`). The MIT LICENSE at the
// repository root governs the rest of this repository; it does NOT apply
// to this file.
//
// TS port of `@lynx-js/react@0.119.0`'s
// `runtime/lib/gesture/processGesture.js`. Source preserved verbatim; only
// types added. Why vendor: upstream's `gesture/processGesture.js` is the
// canonical platform-call sequence used by `@lynx-js/react`'s snapshot
// pipeline. Calling our hand-rolled equivalent on a real device shows the
// gesture arena doesn't engage; vendoring eliminates any subtle divergence.
//
// Sigx-specific deltas:
//   - `dom` is sigx's raw `MainThreadElement`, not a SnapshotInstance member.
//   - Caller passes `isFirstScreen=false` (no SSR/hydration in sigx).
//   - `gestureOptions` always undefined.

import { onWorkletCtxUpdate } from './observers.js';

const COMPOSED = -1;

interface GestureWorklet {
  _wkltId: string;
  _execId?: number;
  _c?: Record<string, unknown>;
  _jsFn?: Record<string, unknown>;
  _workletType?: string;
}

interface BaseGesture {
  __isSerialized: true;
  type: number;
  id: number;
  callbacks: Record<string, GestureWorklet>;
  waitFor?: BaseGesture[];
  simultaneousWith?: BaseGesture[];
  continueWith?: BaseGesture[];
  config?: Record<string, unknown>;
}

interface ComposedGesture {
  __isSerialized: true;
  type: -1;
  gestures: AnyGesture[];
}

type AnyGesture = BaseGesture | ComposedGesture;

interface GestureOptions {
  domSet?: boolean;
}

interface RelationMap {
  waitFor: number[];
  simultaneous: number[];
  continueWith: number[];
}

interface GestureConfig {
  callbacks: { name: string; callback: GestureWorklet }[];
  config?: Record<string, unknown>;
}

function isSerializedGesture(gesture: unknown): gesture is AnyGesture {
  return (gesture as { __isSerialized?: boolean })?.__isSerialized === true;
}

function getSerializedBaseGesture(
  gesture: AnyGesture | undefined,
): BaseGesture | undefined {
  if (!gesture || !isSerializedGesture(gesture)) return undefined;
  if (gesture.type !== COMPOSED) return gesture as BaseGesture;
  return undefined;
}

function appendUniqueSerializedBaseGestures(
  gesture: AnyGesture | undefined,
  out: BaseGesture[],
  seenIds: Set<number>,
): void {
  if (!gesture || !isSerializedGesture(gesture)) return;
  if (gesture.type === COMPOSED) {
    for (const sub of (gesture as ComposedGesture).gestures) {
      appendUniqueSerializedBaseGestures(sub, out, seenIds);
    }
    return;
  }
  const base = gesture as BaseGesture;
  if (seenIds.has(base.id)) return;
  seenIds.add(base.id);
  out.push(base);
}

interface OldGestureInfo {
  uniqOldBaseGestures: BaseGesture[];
  oldBaseGesturesById: Map<number, BaseGesture>;
}

function appendOldGestureInfo(
  gesture: AnyGesture | undefined,
  out: BaseGesture[],
  byId: Map<number, BaseGesture>,
): void {
  if (!gesture || !isSerializedGesture(gesture)) return;
  if (gesture.type === COMPOSED) {
    for (const sub of (gesture as ComposedGesture).gestures) {
      appendOldGestureInfo(sub, out, byId);
    }
    return;
  }
  const base = gesture as BaseGesture;
  if (!byId.has(base.id)) {
    byId.set(base.id, base);
    out.push(base);
  }
}

function collectOldGestureInfo(
  oldGesture: AnyGesture | undefined,
): OldGestureInfo {
  const uniqOldBaseGestures: BaseGesture[] = [];
  const oldBaseGesturesById = new Map<number, BaseGesture>();
  appendOldGestureInfo(oldGesture, uniqOldBaseGestures, oldBaseGesturesById);
  return { uniqOldBaseGestures, oldBaseGesturesById };
}

function consumeOldBaseGesture(
  baseGesture: BaseGesture,
  uniqOldBaseGestures: BaseGesture[],
  oldBaseGesturesById: Map<number, BaseGesture>,
): BaseGesture | undefined {
  const idMatched = oldBaseGesturesById.get(baseGesture.id);
  if (idMatched) {
    oldBaseGesturesById.delete(baseGesture.id);
    return idMatched;
  }
  const fallback = uniqOldBaseGestures.find((og) =>
    oldBaseGesturesById.has(og.id),
  );
  if (!fallback) return undefined;
  oldBaseGesturesById.delete(fallback.id);
  return fallback;
}

function removeGestureDetector(dom: MainThreadElement, id: number): void {
  if (typeof __RemoveGestureDetector === 'function') {
    __RemoveGestureDetector(dom, id);
  }
}

function getGestureInfo(
  gesture: BaseGesture,
  oldGesture: BaseGesture | undefined,
  isFirstScreen: boolean,
  dom: MainThreadElement,
): { config: GestureConfig; relationMap: RelationMap } {
  const config: GestureConfig = { callbacks: [] };
  if (gesture.config) {
    config.config = gesture.config;
  }
  for (const key of Object.keys(gesture.callbacks)) {
    const callback = gesture.callbacks[key]!;
    const oldCallback = oldGesture?.callbacks[key];
    // Upstream types `Worklet._c` as `Record<string, ClosureValueType>`; ours
    // is `Record<string, unknown>` from the wire. The runtime contract is
    // identical — cast through `unknown` to satisfy the upstream signature.
    onWorkletCtxUpdate(
      callback as unknown as Parameters<typeof onWorkletCtxUpdate>[0],
      oldCallback as unknown as Parameters<typeof onWorkletCtxUpdate>[1],
      isFirstScreen,
      dom as unknown as Parameters<typeof onWorkletCtxUpdate>[3],
    );
    config.callbacks.push({ name: key, callback });
  }
  const relationMap: RelationMap = {
    waitFor: gesture.waitFor?.map((g) => g.id) ?? [],
    simultaneous: gesture.simultaneousWith?.map((g) => g.id) ?? [],
    continueWith: gesture.continueWith?.map((g) => g.id) ?? [],
  };
  return { config, relationMap };
}

export function processGesture(
  dom: MainThreadElement,
  gesture: AnyGesture | undefined,
  oldGesture: AnyGesture | undefined,
  isFirstScreen: boolean,
  gestureOptions?: GestureOptions,
): void {
  const domSet = gestureOptions?.domSet === true;
  const { uniqOldBaseGestures, oldBaseGesturesById } =
    collectOldGestureInfo(oldGesture);

  const singleBaseGesture = getSerializedBaseGesture(gesture);
  const singleOldBaseGesture = getSerializedBaseGesture(oldGesture);

  if (singleBaseGesture && (!oldGesture || singleOldBaseGesture)) {
    if (!domSet) {
      __SetAttribute(dom, 'has-react-gesture', true);
      __SetAttribute(dom, 'flatten', false);
    }
    if (singleOldBaseGesture) {
      removeGestureDetector(dom, singleOldBaseGesture.id);
    }
    const { config, relationMap } = getGestureInfo(
      singleBaseGesture,
      singleOldBaseGesture,
      isFirstScreen,
      dom,
    );
    __SetGestureDetector(
      dom,
      singleBaseGesture.id,
      singleBaseGesture.type,
      config,
      relationMap,
    );
    return;
  }

  const uniqBaseGestures: BaseGesture[] = [];
  appendUniqueSerializedBaseGestures(gesture, uniqBaseGestures, new Set());
  if (uniqBaseGestures.length === 0) {
    for (const og of oldBaseGesturesById.values()) {
      removeGestureDetector(dom, og.id);
    }
    if (!domSet) {
      __SetAttribute(dom, 'has-react-gesture', null);
    }
    return;
  }

  if (!domSet) {
    __SetAttribute(dom, 'has-react-gesture', true);
    __SetAttribute(dom, 'flatten', false);
  }

  for (const og of oldBaseGesturesById.values()) {
    removeGestureDetector(dom, og.id);
  }

  for (const base of uniqBaseGestures) {
    const oldBase = consumeOldBaseGesture(
      base,
      uniqOldBaseGestures,
      oldBaseGesturesById,
    );
    const { config, relationMap } = getGestureInfo(
      base,
      oldBase,
      isFirstScreen,
      dom,
    );
    __SetGestureDetector(dom, base.id, base.type, config, relationMap);
  }
}
