/**
 * Full in-process round trip (#630): the real BG renderer emits snapshot
 * ops → applyOps replays them against fake PAPI → assert the final tree and
 * that events dispatched by sign reach the BG handler.
 *
 * This is the closest a unit test gets to the production pipeline — the
 * only fakes are the PAPI globals and the wire (ops handed over as an
 * in-memory array instead of JSON over callLepusMethod).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRenderer } from '@sigx/runtime-core/internals';
import { jsx } from '@sigx/runtime-core';
import {
  __pageId,
  createSnapshot,
  resetSnapshotRegistry,
  setSnapshotPageId,
  snapshotCreatorMap,
  updateEvent,
} from '@sigx/lynx-runtime-internal/snapshot';
import {
  nodeOps,
  resetNodeOpsState,
  resetOpQueue,
  resetRegistry,
  resetShadowState,
  takeOps,
  publishEvent,
  ShadowElement,
} from '@sigx/lynx-runtime';
import { elements } from '../src/element-registry';
import { resetSlotStates, flushDirtySlots } from '../src/event-slots';
import { applyOps, resetMainThreadState, setPlaceholder } from '../src/ops-apply';
import { installSnapshotMTHooks, resetSnapshotInstances } from '../src/snapshot-mt';

type FakeEl = { __id: number; tag: string; children: FakeEl[]; attrs: Record<string, unknown> };
let nextUid = 7000;
function makeEl(tag: string): FakeEl {
  return { __id: nextUid++, tag, children: [], attrs: {} };
}

let addEventCalls: Array<{ el: FakeEl; type: string; name: string; value: unknown }> = [];

beforeEach(() => {
  resetOpQueue();
  resetRegistry();
  resetNodeOpsState();
  resetShadowState();
  resetSnapshotRegistry();
  resetSnapshotInstances();
  resetSlotStates();
  resetMainThreadState();
  elements.clear();
  nextUid = 7000;
  addEventCalls = [];

  vi.stubGlobal('__CreateView', vi.fn(() => makeEl('view')));
  vi.stubGlobal('__CreateText', vi.fn(() => makeEl('text')));
  vi.stubGlobal('__CreateRawText', vi.fn(() => makeEl('raw-text')));
  vi.stubGlobal('__CreateElement', vi.fn((tag: string) => makeEl(tag)));
  vi.stubGlobal('__AppendElement', vi.fn((p: FakeEl, c: FakeEl) => { p.children.push(c); }));
  vi.stubGlobal('__InsertElementBefore', vi.fn((p: FakeEl, c: FakeEl, a: FakeEl) => {
    const idx = p.children.indexOf(a);
    p.children.splice(idx === -1 ? p.children.length : idx, 0, c);
  }));
  vi.stubGlobal('__RemoveElement', vi.fn((p: FakeEl, c: FakeEl) => {
    p.children = p.children.filter((x) => x !== c);
  }));
  vi.stubGlobal('__SetCSSId', vi.fn());
  vi.stubGlobal('__SetAttribute', vi.fn((el: FakeEl, k: string, v: unknown) => { el.attrs[k] = v; }));
  vi.stubGlobal('__SetInlineStyles', vi.fn());
  vi.stubGlobal('__SetClasses', vi.fn());
  vi.stubGlobal('__SetID', vi.fn());
  vi.stubGlobal('__AddEvent', vi.fn((el: FakeEl, type: string, name: string, value: unknown) => {
    addEventCalls.push({ el, type, name, value });
  }));
  vi.stubGlobal('__FlushElementTree', vi.fn());
  vi.stubGlobal('__GetElementUniqueID', vi.fn((el: FakeEl) => el.__id));

  installSnapshotMTHooks();
  setSnapshotPageId(7);

  const page = makeEl('page');
  elements.set(1, page as never);
  setPlaceholder(page as never, makeEl('placeholder') as never);
});

/**
 * Register a template in the exact compiled shape: a <view> whose holes are
 * [0] a tap event on el0 and [1] the text of a raw-text child.
 */
const TPL = '__snapshot_rt_1';
function registerTemplate(): void {
  snapshotCreatorMap[TPL] = (id) =>
    createSnapshot(
      id,
      function () {
        const el0 = __CreateView(__pageId) as unknown as FakeEl;
        const el1 = __CreateText(__pageId) as unknown as FakeEl;
        const el2 = __CreateRawText('') as unknown as FakeEl;
        __AppendElement(el1 as never, el2 as never);
        __AppendElement(el0 as never, el1 as never);
        return [el0, el1, el2] as unknown[];
      } as never,
      [
        (ctx, index, oldValue) => updateEvent(ctx, index, oldValue, 0, 'bindEvent', 'tap', ''),
        (ctx, index) => {
          if (ctx.__elements) {
            __SetAttribute(ctx.__elements[2] as never, 'text', ctx.__values[index]);
          }
        },
      ],
      [[6, 0]],
      undefined,
      undefined,
      [0],
      true,
    );
}

/** Ship whatever the BG queued over the (in-memory) wire. */
function flushWire(): void {
  const ops = takeOps();
  if (ops.length) applyOps(JSON.parse(JSON.stringify(ops)) as unknown[]);
}

describe('snapshot round trip', () => {
  it('renders a template end to end, patches holes, fires events', () => {
    registerTemplate();
    const renderer = createRenderer(nodeOps);
    const root = nodeOps.createElement('page');
    // Alias the BG root to the MT page (id 1 = page root on both sides is
    // production behavior; here the BG root gets id 2+, so map it).
    flushWire(); // ship root CREATE
    // The BG root was created as a plain element — applyOps has built it.

    let taps = 0;
    const view = (text: string): unknown =>
      jsx(TPL, {
        values: [() => { taps++; }, text],
        children: [],
      } as never);

    renderer.render(view('first') as never, root as never);
    flushWire();
    flushDirtySlots();

    // The template materialized under the BG root's MT counterpart.
    const rootEl = elements.get((root as ShadowElement).id) as unknown as FakeEl;
    expect(rootEl).toBeDefined();
    // Children = the template root plus the component's comment anchor.
    const cells = rootEl.children.filter((c) => c.tag === 'view');
    expect(cells).toHaveLength(1);
    const cell = cells[0];
    expect(cell.children[0]?.children[0]?.attrs['text']).toBe('first');

    // Event: __AddEvent got the BG sign; dispatching it runs the handler.
    expect(addEventCalls).toHaveLength(1);
    const sign = addEventCalls[0].value as string;
    publishEvent(sign, { detail: {} });
    expect(taps).toBe(1);

    // Hole patch on re-render: exactly one SNAPSHOT_SET_VALUE crosses the
    // wire (the event hole's sign is stable; only the text hole changed) and
    // lands as one attr write. Reactive scheduling itself is runtime-core's
    // concern — the diff path is what this suite covers.
    renderer.render(view('second') as never, root as never);
    const ops = takeOps();
    expect(ops.filter((op) => op === 24 /* SNAPSHOT_SET_VALUE */)).toHaveLength(1);
    applyOps(JSON.parse(JSON.stringify(ops)) as unknown[]);
    expect(cell.children[0]?.children[0]?.attrs['text']).toBe('second');
  });

  it('unmount removes the materialized subtree from the MT tree', () => {
    registerTemplate();
    const renderer = createRenderer(nodeOps);
    const root = nodeOps.createElement('page');
    flushWire();

    renderer.render(jsx(TPL, { values: [null, 'x'], children: [] } as never) as never, root as never);
    flushWire();
    const rootEl = elements.get((root as ShadowElement).id) as unknown as FakeEl;
    expect(rootEl.children.filter((c) => c.tag === 'view')).toHaveLength(1);

    renderer.render(null as never, root as never);
    flushWire();
    expect(rootEl.children.filter((c) => c.tag === 'view')).toHaveLength(0);
  });
});
