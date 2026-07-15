/**
 * Tests for the JSX snapshot slot rewrite (jsx-runtime.ts, #630): `$N` props
 * on registered snapshot types become keyed `'__sigx-slot'` children; every
 * other call passes through to @sigx/runtime-core untouched.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createSnapshot,
  resetSnapshotRegistry,
  snapshotCreatorMap,
} from '@sigx/lynx-runtime-internal/snapshot';
import { jsx } from '../src/jsx-runtime';

const TPL = '__snapshot_jsx_1';

interface VNodeLike {
  type: unknown;
  props: Record<string, unknown> | null;
  key?: unknown;
  children?: unknown;
}

beforeEach(() => {
  resetSnapshotRegistry();
  snapshotCreatorMap[TPL] = (id) => createSnapshot(id, null, null, [[6, 1], [6, 2]]);
});

describe('jsx snapshot slot rewrite', () => {
  it('rewrites $N props into keyed __sigx-slot children', () => {
    const inner = jsx('text', { children: 'hi' }) as VNodeLike;
    const vnode = jsx(TPL, { values: [1], $0: 'title', $1: inner }) as VNodeLike;

    const props = vnode.props ?? {};
    expect(props['$0']).toBeUndefined();
    expect(props['$1']).toBeUndefined();
    expect(props['values']).toEqual([1]);

    // runtime-core moves children out of props — find them wherever it put
    // them (props.children or vnode.children depending on version).
    const children = (props['children'] ?? vnode.children) as VNodeLike[];
    expect(Array.isArray(children)).toBe(true);
    expect(children).toHaveLength(2);
    const slotTypes = children.map((c) => c.type);
    expect(slotTypes).toEqual(['__sigx-slot', '__sigx-slot']);
    const keys = children.map((c) => c.key);
    expect(keys).toEqual(['$0', '$1']);
  });

  it('passes snapshot calls without slot props through untouched', () => {
    const vnode = jsx(TPL, { values: ['x'] }) as VNodeLike;
    expect(vnode.type).toBe(TPL);
    expect((vnode.props ?? {})['values']).toEqual(['x']);
  });

  it('leaves non-snapshot types alone even with $-prefixed props', () => {
    const vnode = jsx('view', { $0: 'not-a-slot' } as never) as VNodeLike;
    const props = vnode.props ?? {};
    expect(props['$0']).toBe('not-a-slot');
  });
});
