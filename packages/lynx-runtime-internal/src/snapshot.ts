/**
 * Snapshot-template transform contract (#626, phase 2 of #620).
 *
 * This module is what the upstream `@lynx-js/react/transform` snapshot pass
 * targets via its `runtimePkg` option. Compiled output imports it as a
 * namespace and emits, per static JSX subtree:
 *
 *   import * as ReactLynx from '<runtimePkg>';
 *   const __snapshot_ab12_cd34_1 = "__snapshot_ab12_cd34_1";
 *   ReactLynx.snapshotCreatorMap[__snapshot_ab12_cd34_1] = (id) =>
 *     ReactLynx.createSnapshot(id, create, updates, slots, cssId,
 *                              globDynamicComponentEntry, refAndSpreadIdx, true);
 *
 * where `create(ctx)` builds the subtree with direct element-PAPI calls and
 * `updates[i](ctx, i, oldValue)` patches dynamic hole `i` from
 * `ctx.__values[i]`. On the background (`target: 'JS'`) build the transform
 * compiles `create`/`update` to `null` — registrations there carry only slot
 * metadata.
 *
 * THREAD NEUTRALITY: this package is a shared leaf dependency of both bundle
 * layers and its dist passes through the MT loader verbatim (cross-layer
 * module identity), so the module itself must be byte-identical on both
 * threads. Anything element- or thread-specific is delegated through
 * `installSnapshotHooks(impl)`, which only the MT bootstrap
 * (`@sigx/lynx-runtime-main/entry-main`) calls. Before installation every
 * updater is a no-op — which is also the correct background behavior, where
 * updaters are never invoked (nulled `update` arrays) but must exist as
 * namespace members.
 */

/** Opaque host element handle (MainThreadElement on the MT; never a value on BG). */
export type SnapshotElement = unknown;

/**
 * The instance shape the compiled `create`/`update` closures see. The MT
 * runtime's instance class satisfies this; the field names are part of the
 * generated-code contract and must not be renamed.
 */
export interface SnapshotInstanceLike {
  __id: number;
  __values: unknown[];
  __elements: SnapshotElement[] | null;
}

export type SnapshotCreateFn = (ctx: SnapshotInstanceLike) => SnapshotElement[];
export type SnapshotUpdateFn = (
  ctx: SnapshotInstanceLike,
  index: number,
  oldValue: unknown,
) => void;

/** `[DynamicPartType, elementIndex]` — elementIndex points into `create()`'s return. */
export type SnapshotSlotEntry = [number, number];

export interface SnapshotDef {
  uniqID: string;
  /** null on the background build (compiled out by the transform). */
  create: SnapshotCreateFn | null;
  /** null on the background build, or when the subtree has no dynamic holes. */
  update: SnapshotUpdateFn[] | null;
  slot: SnapshotSlotEntry[] | null;
  cssId: number | undefined;
  refAndSpreadIndexes: number[] | null;
}

// ---------------------------------------------------------------------------
// DynamicPartType constants (generated code references these by name)
// ---------------------------------------------------------------------------

export const __DynamicPartAttr = 0;
export const __DynamicPartSpread = 1;
export const __DynamicPartSlot = 2;
export const __DynamicPartChildren = 3;
export const __DynamicPartListChildren = 4;
export const __DynamicPartMultiChildren = 5;
export const __DynamicPartSlotV2 = 6;
export const __DynamicPartListSlotV2 = 7;

// Precomputed single-slot forms the transform references directly.
export const __DynamicPartChildren_0: SnapshotSlotEntry[] = [[__DynamicPartChildren, 0]];
export const __DynamicPartListChildren_0: SnapshotSlotEntry[] = [[__DynamicPartListChildren, 0]];
export const __DynamicPartSlotV2_0: SnapshotSlotEntry[] = [[__DynamicPartSlotV2, 0]];
export const __DynamicPartListSlotV2_0: SnapshotSlotEntry[] = [[__DynamicPartListSlotV2, 0]];

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** uniqID → resolved definition. */
export const snapshotManager: { values: Map<string, SnapshotDef> } = {
  values: new Map(),
};

/**
 * uniqID → lazy creator. The transform registers through this map (one
 * assignment per template at module-eval time); definitions materialize on
 * first use via `getSnapshotDef`. Also doubles as the "is this string a
 * template id" registry for the background renderer.
 */
export const snapshotCreatorMap: Record<string, (uniqID: string) => string> = {};

/**
 * Store a snapshot definition. Signature matches the generated call exactly —
 * `entryName` (the transform passes its `globDynamicComponentEntry` inject)
 * and `isLazySnapshotSupported` are accepted but unused: with lazy support on
 * (the transform always passes `true` for us) ids are NOT entry-namespaced.
 */
export function createSnapshot(
  uniqID: string,
  create: SnapshotCreateFn | null,
  update: SnapshotUpdateFn[] | null,
  slot: SnapshotSlotEntry[] | null,
  cssId?: number,
  _entryName?: string,
  refAndSpreadIndexes?: number[] | null,
  _isLazySnapshotSupported?: boolean,
): string {
  snapshotManager.values.set(uniqID, {
    uniqID,
    create,
    update,
    slot,
    cssId,
    refAndSpreadIndexes: refAndSpreadIndexes ?? null,
  });
  return uniqID;
}

/**
 * Resolve a definition, invoking its lazy creator on first use.
 * Returns undefined for unknown ids (caller decides how loud to fail).
 */
export function getSnapshotDef(uniqID: string): SnapshotDef | undefined {
  const existing = snapshotManager.values.get(uniqID);
  if (existing) return existing;
  // Own-key check: a plain-object registry must not resolve inherited
  // properties ("toString" is not a template).
  if (!Object.prototype.hasOwnProperty.call(snapshotCreatorMap, uniqID)) {
    return undefined;
  }
  snapshotCreatorMap[uniqID](uniqID);
  return snapshotManager.values.get(uniqID);
}

/** True when `type` names a registered template (registry-based, not prefix-based). */
export function isSnapshotType(type: string): boolean {
  return (
    snapshotManager.values.has(type)
    || Object.prototype.hasOwnProperty.call(snapshotCreatorMap, type)
  );
}

/** Test/HMR reset. Does not touch installed hooks. */
export function resetSnapshotRegistry(): void {
  snapshotManager.values.clear();
  for (const key of Object.keys(snapshotCreatorMap)) {
    delete snapshotCreatorMap[key];
  }
}

/**
 * The file-stable segment of a template id. Ids are
 * `__snapshot_<filenameHash>_<contentHash>_<n>` — an edit rotates the content
 * hash (and thus every id in the file) while the filename hash stays put, so
 * `__snapshot_<filenameHash>_` identifies "templates from this file".
 */
function snapshotFilePrefix(id: string): string | null {
  const m = /^(__snapshot_[A-Za-z0-9]+_)/.exec(id);
  return m ? m[1] : null;
}

/**
 * HMR stale-template purge: for every file prefix present in `incomingIds`,
 * drop registry entries under that prefix that are NOT in the incoming set —
 * they are the previous edit's creators, unreachable forever (and, worse,
 * still resolvable by stale op batches). Ids under untouched files' prefixes
 * are left alone. Returns the number of purged entries.
 */
export function purgeSnapshotTemplatesByPrefix(incomingIds: readonly string[]): number {
  const incoming = new Set(incomingIds);
  const prefixes = new Set<string>();
  for (const id of incomingIds) {
    const p = snapshotFilePrefix(id);
    if (p) prefixes.add(p);
  }
  if (prefixes.size === 0) return 0;

  let purged = 0;
  const stale = (key: string): boolean => {
    const p = snapshotFilePrefix(key);
    return p !== null && prefixes.has(p) && !incoming.has(key);
  };
  for (const key of Object.keys(snapshotCreatorMap)) {
    if (stale(key)) {
      delete snapshotCreatorMap[key];
      purged++;
    }
  }
  for (const key of [...snapshotManager.values.keys()]) {
    if (stale(key)) {
      snapshotManager.values.delete(key);
      purged++;
    }
  }
  return purged;
}

// ---------------------------------------------------------------------------
// Page id (compiled `create` bodies read `ReactLynx.__pageId`)
// ---------------------------------------------------------------------------

/**
 * PAPI unique id of the page root, passed as `parentComponentUniqueId` to
 * every element-creation call inside compiled `create` bodies. Set by the MT
 * bootstrap's `renderPage` before any template can instantiate. ESM live
 * binding: namespace reads observe updates.
 */
export let __pageId = 0;

export function setSnapshotPageId(id: number): void {
  __pageId = id;
}

// ---------------------------------------------------------------------------
// Hole updaters — thin delegates to the MT-installed hooks
// ---------------------------------------------------------------------------

/**
 * Element- and thread-specific behavior, installed exactly once by the MT
 * bootstrap. Each method mirrors one generated-code updater; see
 * `@sigx/lynx-runtime-main/snapshot-mt` for the implementation.
 */
export interface SnapshotHooks {
  updateEvent(
    ctx: SnapshotInstanceLike,
    index: number,
    oldValue: unknown,
    elementIndex: number,
    eventType: string,
    eventName: string,
    spreadKey: string,
  ): void;
  updateWorkletEvent(
    ctx: SnapshotInstanceLike,
    index: number,
    oldValue: unknown,
    elementIndex: number,
    workletType: string,
    eventType: string,
    eventName: string,
  ): void;
  updateRef(ctx: SnapshotInstanceLike, index: number, oldValue: unknown, elementIndex: number): void;
  updateWorkletRef(ctx: SnapshotInstanceLike, index: number, oldValue: unknown, elementIndex: number): void;
  updateGesture(ctx: SnapshotInstanceLike, index: number, oldValue: unknown, elementIndex: number): void;
  updateSpread(ctx: SnapshotInstanceLike, index: number, oldValue: unknown, elementIndex: number): void;
  updateListItemPlatformInfo(
    ctx: SnapshotInstanceLike,
    index: number,
    oldValue: unknown,
    elementIndex: number,
  ): void;
  createList(pageId: number, ctx: SnapshotInstanceLike, expIndex: number): SnapshotElement;
}

let hooks: SnapshotHooks | null = null;

/** Called once from the MT bootstrap. Idempotent (last install wins). */
export function installSnapshotHooks(impl: SnapshotHooks): void {
  hooks = impl;
}

export function updateEvent(
  ctx: SnapshotInstanceLike,
  index: number,
  oldValue: unknown,
  elementIndex: number,
  eventType: string,
  eventName: string,
  spreadKey: string,
): void {
  hooks?.updateEvent(ctx, index, oldValue, elementIndex, eventType, eventName, spreadKey);
}

export function updateWorkletEvent(
  ctx: SnapshotInstanceLike,
  index: number,
  oldValue: unknown,
  elementIndex: number,
  workletType: string,
  eventType: string,
  eventName: string,
): void {
  hooks?.updateWorkletEvent(ctx, index, oldValue, elementIndex, workletType, eventType, eventName);
}

export function updateRef(
  ctx: SnapshotInstanceLike,
  index: number,
  oldValue: unknown,
  elementIndex: number,
): void {
  hooks?.updateRef(ctx, index, oldValue, elementIndex);
}

export function updateWorkletRef(
  ctx: SnapshotInstanceLike,
  index: number,
  oldValue: unknown,
  elementIndex: number,
): void {
  hooks?.updateWorkletRef(ctx, index, oldValue, elementIndex);
}

export function updateGesture(
  ctx: SnapshotInstanceLike,
  index: number,
  oldValue: unknown,
  elementIndex: number,
): void {
  hooks?.updateGesture(ctx, index, oldValue, elementIndex);
}

export function updateSpread(
  ctx: SnapshotInstanceLike,
  index: number,
  oldValue: unknown,
  elementIndex: number,
): void {
  hooks?.updateSpread(ctx, index, oldValue, elementIndex);
}

export function updateListItemPlatformInfo(
  ctx: SnapshotInstanceLike,
  index: number,
  oldValue: unknown,
  elementIndex: number,
): void {
  hooks?.updateListItemPlatformInfo(ctx, index, oldValue, elementIndex);
}

/**
 * Compiled `<list>` create bodies call this instead of a bare `__CreateList`.
 * Loud failure without hooks (or before list-template support lands): a
 * silent null would surface as a blank list far from the cause.
 */
export function snapshotCreateList(
  pageId: number,
  ctx: SnapshotInstanceLike,
  expIndex: number,
): SnapshotElement {
  if (!hooks) {
    throw new Error(
      '[sigx-snapshot] snapshotCreateList called before MT hooks were installed',
    );
  }
  return hooks.createList(pageId, ctx, expIndex);
}

/**
 * Background-side ref normalization used by spread updaters in the reference
 * implementation. sigx routes refs through its own wire values (wvid
 * objects); v1 passes values through untouched. Kept for generated-code
 * compatibility.
 */
export function transformRef(ref: unknown): unknown {
  return ref;
}
