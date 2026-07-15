/**
 * sigx-lynx JSX runtime — @sigx/runtime-core's factories plus the snapshot
 * slot rewrite (#630, phase 4a of #620).
 *
 * Compiled snapshot templates render as `_jsx(uniqID, { values, $0, $1… })`:
 * `values` carries the dynamic-hole payload and each `$N` prop carries slot
 * N's child content. runtime-core treats unknown props as host attributes,
 * so slot content would never mount — the wrapper rewrites each `$N` prop
 * into a child of a synthetic `'__sigx-slot'` host element (keyed by slot
 * index). The slot element aliases a template-inner host on the MT (see
 * SNAPSHOT_BIND_SLOT), and runtime-core's ordinary keyed diff then drives
 * conditionals and list maps inside slots with zero new diffing code.
 *
 * Non-snapshot types pass through untouched.
 */

import {
  Fragment,
  jsx as coreJsx,
  jsxs as coreJsxs,
} from '@sigx/runtime-core';
import { isSnapshotType } from '@sigx/lynx-runtime-internal/snapshot';

type JsxFactory = (
  type: string | Function | typeof Fragment,
  props: Record<string, unknown> | null,
  key?: string,
) => unknown;

function rewriteSnapshotProps(
  type: unknown,
  props: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (typeof type !== 'string' || !props || !isSnapshotType(type)) return props;
  let hasSlots = false;
  for (const k in props) {
    if (k.charCodeAt(0) === 36 /* '$' */) {
      hasSlots = true;
      break;
    }
  }
  if (!hasSlots) return props;

  const rest: Record<string, unknown> = {};
  // Only strict `$<digits>` keys are slot holes; ordering is by numeric
  // index, never object insertion order.
  const indices: number[] = [];
  const byIndex = new Map<number, unknown>();
  for (const [k, v] of Object.entries(props)) {
    if (/^\$\d+$/.test(k)) {
      const slotIndex = Number(k.slice(1));
      indices.push(slotIndex);
      byIndex.set(slotIndex, v);
    } else {
      rest[k] = v;
    }
  }
  indices.sort((a, b) => a - b);
  rest['children'] = indices.map((slotIndex) =>
    coreJsx(
      '__sigx-slot',
      { __slotIndex: slotIndex, children: byIndex.get(slotIndex) } as Parameters<typeof coreJsx>[1],
      `$${slotIndex}`,
    ));
  return rest;
}

export function jsx(
  type: string | Function | typeof Fragment,
  props: Record<string, unknown> | null,
  key?: string,
): unknown {
  return (coreJsx as JsxFactory)(type, rewriteSnapshotProps(type, props), key);
}

export function jsxs(
  type: string | Function | typeof Fragment,
  props: Record<string, unknown> | null,
  key?: string,
): unknown {
  return (coreJsxs as JsxFactory)(type, rewriteSnapshotProps(type, props), key);
}

export { Fragment };
