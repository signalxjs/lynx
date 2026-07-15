/**
 * Golden op-stream tests for BG snapshot emission (#630): the real
 * runtime-core renderer drives nodeOps with snapshot vnodes and we assert
 * the exact wire sequences.
 *
 * Slot vnodes are constructed in the shape @sigx/lynx's jsx wrapper emits
 * (`'__sigx-slot'` host elements with `__slotIndex` + children) — the
 * wrapper itself is covered in packages/lynx/__tests__/jsx-snapshot.test.ts.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createRenderer } from '@sigx/runtime-core/internals';
import { jsx } from '@sigx/runtime-core';
import {
  createSnapshot,
  resetSnapshotRegistry,
  snapshotCreatorMap,
} from '@sigx/lynx-runtime-internal/snapshot';
import { OP } from '@sigx/lynx-runtime-internal';
import { nodeOps, resetNodeOpsState } from '../src/nodeOps';
import { resetOpQueue, takeOps } from '../src/op-queue';
import { publishEvent, resetRegistry } from '../src/event-registry';
import { ShadowElement, resetShadowState } from '../src/shadow-element';
import { MainThreadRef, resetWvidCounter } from '../src/main-thread-ref';

const TPL = '__snapshot_emit_1';

function registerTemplate(): void {
  snapshotCreatorMap[TPL] = (id) => createSnapshot(id, null, null, [[6, 1]]);
}

function snap(props: Record<string, unknown>, slotChildren?: unknown): unknown {
  const children = slotChildren === undefined
    ? []
    : [jsx('__sigx-slot', { __slotIndex: 0, children: slotChildren } as never, '$0')];
  return jsx(TPL, { ...props, children } as never);
}

/** Parse the flat ops array into [code, ...args] records (snapshot-aware). */
function parseOps(flat: unknown[]): unknown[][] {
  const arity: Record<number, number> = {
    [OP.CREATE]: 2,
    [OP.CREATE_TEXT]: 1,
    [OP.INSERT]: 3,
    [OP.REMOVE]: 2,
    [OP.SET_PROP]: 3,
    [OP.SET_TEXT]: 2,
    [OP.SET_EVENT]: 4,
    [OP.REMOVE_EVENT]: 3,
    [OP.SET_STYLE]: 2,
    [OP.SET_CLASS]: 2,
    [OP.SNAPSHOT_CREATE]: 2,
    [OP.SNAPSHOT_SET_VALUES]: 2,
    [OP.SNAPSHOT_SET_VALUE]: 3,
    [OP.SNAPSHOT_BIND_SLOT]: 3,
  };
  const records: unknown[][] = [];
  let i = 0;
  while (i < flat.length) {
    const code = flat[i++] as number;
    const n = arity[code];
    if (n === undefined) throw new Error(`unknown op ${code} in test stream`);
    records.push([code, ...flat.slice(i, i + n)]);
    i += n;
  }
  return records;
}

let renderer: any;
let root: ShadowElement;

beforeEach(() => {
  resetOpQueue();
  resetRegistry();
  resetNodeOpsState();
  resetShadowState();
  resetWvidCounter();
  resetSnapshotRegistry();
  registerTemplate();
  renderer = createRenderer(nodeOps);
  root = nodeOps.createElement('page');
  takeOps(); // drop root-creation noise
});

describe('snapshot emission', () => {
  it('mounts as SNAPSHOT_CREATE + SET_VALUES, slot children after BIND_SLOT', () => {
    renderer.render(
      snap({ values: ['hello'] }, jsx('view', {} as never)) as never,
      root as never,
    );
    const records = parseOps(takeOps());
    const codes = records.map((r) => r[0]);

    const createIdx = codes.indexOf(OP.SNAPSHOT_CREATE);
    const valuesIdx = codes.indexOf(OP.SNAPSHOT_SET_VALUES);
    const bindIdx = codes.indexOf(OP.SNAPSHOT_BIND_SLOT);
    expect(createIdx).toBeGreaterThanOrEqual(0);
    expect(valuesIdx).toBeGreaterThan(createIdx);
    expect(bindIdx).toBeGreaterThan(createIdx);

    // The slot child's INSERT must come AFTER the slot bind, targeting the
    // slot element id.
    const bind = records[bindIdx];
    const slotElId = bind[3];
    expect(bind[2]).toBe(0); // slotIndex
    const childInsert = records.findIndex(
      (r, idx) => idx > bindIdx && r[0] === OP.INSERT && r[1] === slotElId,
    );
    expect(childInsert).toBeGreaterThan(bindIdx);

    // Values wire: full array once, no per-hole ops at mount.
    expect(records[valuesIdx][2]).toEqual(['hello']);
    expect(codes).not.toContain(OP.SNAPSHOT_SET_VALUE);
  });

  it('re-render with one changed hole emits exactly one SNAPSHOT_SET_VALUE', () => {
    renderer.render(snap({ values: ['a', 1] }) as never, root as never);
    takeOps();
    renderer.render(snap({ values: ['a', 2] }) as never, root as never);
    const records = parseOps(takeOps());
    const snapshotOps = records.filter((r) =>
      r[0] === OP.SNAPSHOT_SET_VALUE || r[0] === OP.SNAPSHOT_SET_VALUES || r[0] === OP.SNAPSHOT_CREATE,
    );
    expect(snapshotOps).toHaveLength(1);
    expect(snapshotOps[0][0]).toBe(OP.SNAPSHOT_SET_VALUE);
    expect(snapshotOps[0][2]).toBe(1); // hole index
    expect(snapshotOps[0][3]).toBe(2);
  });

  it('handler-only changes are op-free: stable sign, swapped handler', () => {
    const calls: unknown[] = [];
    renderer.render(snap({ values: [() => calls.push('first')] }) as never, root as never);
    const mount = parseOps(takeOps());
    const values = mount.find((r) => r[0] === OP.SNAPSHOT_SET_VALUES)!;
    const sign = (values[2] as unknown[])[0] as string;
    expect(sign).toMatch(/^sigx:/);

    renderer.render(snap({ values: [() => calls.push('second')] }) as never, root as never);
    const rerender = parseOps(takeOps());
    expect(rerender).toHaveLength(0);

    publishEvent(sign, { detail: {} });
    expect(calls).toEqual(['second']);
  });

  it('normalizes MainThreadRef holes to { __wvid }', () => {
    const ref = new MainThreadRef(null);
    renderer.render(snap({ values: [ref] }) as never, root as never);
    const records = parseOps(takeOps());
    const values = records.find((r) => r[0] === OP.SNAPSHOT_SET_VALUES)!;
    expect((values[2] as unknown[])[0]).toEqual({ __wvid: ref._wvid });
  });

  it('normalizes spread holes per entry (functions get stable signs)', () => {
    const onTap = () => {};
    renderer.render(
      snap({ values: [{ class: 'chip', bindtap: onTap }] }) as never,
      root as never,
    );
    const records = parseOps(takeOps());
    const values = records.find((r) => r[0] === OP.SNAPSHOT_SET_VALUES)!;
    const wire = (values[2] as unknown[])[0] as Record<string, unknown>;
    expect(wire['class']).toBe('chip');
    expect(wire['bindtap']).toMatch(/^sigx:/);
  });

  it('unmount emits REMOVE and releases event signs', () => {
    let fired = false;
    renderer.render(snap({ values: [() => { fired = true; }] }) as never, root as never);
    const mount = parseOps(takeOps());
    const captured = ((mount.find((r) => r[0] === OP.SNAPSHOT_SET_VALUES)!)[2] as string[])[0];

    renderer.render(null as never, root as never);
    const records = parseOps(takeOps());
    expect(records.some((r) => r[0] === OP.REMOVE)).toBe(true);

    // Dispatching the released sign is a no-op (handler unregistered).
    publishEvent(captured, {});
    expect(fired).toBe(false);
  });
});
