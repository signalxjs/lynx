/**
 * Tests for snapshot HMR support on the MT (#637): stale-template purge by
 * filename-hash prefix, and park-and-retry for op batches that outrun their
 * template registrations. Fake-PAPI harness per snapshot-ops.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OP } from '@sigx/lynx-runtime-internal';
import {
  __pageId,
  createSnapshot,
  getSnapshotDef,
  isSnapshotType,
  purgeSnapshotTemplatesByPrefix,
  resetSnapshotRegistry,
  setSnapshotPageId,
  snapshotCreatorMap,
  snapshotManager,
} from '@sigx/lynx-runtime-internal/snapshot';
import { elements } from '../src/element-registry';
import { resetSlotStates } from '../src/event-slots';
import { applyOps, resetMainThreadState, setPlaceholder } from '../src/ops-apply';
import {
  isParkedSnapshot,
  isSnapshotInstance,
  resetSnapshotInstances,
  retryParkedSnapshots,
} from '../src/snapshot-mt';

type FakeEl = { __id: number; tag: string; children: FakeEl[] };
let nextUid = 7000;
function makeEl(tag: string): FakeEl {
  return { __id: nextUid++, tag, children: [] };
}

let createViewCalls = 0;
let textWrites: Array<unknown> = [];
let logs: string[] = [];

beforeEach(() => {
  resetMainThreadState();
  resetSnapshotRegistry();
  resetSnapshotInstances();
  resetSlotStates();
  elements.clear();
  nextUid = 7000;
  createViewCalls = 0;
  textWrites = [];
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });

  vi.stubGlobal('__CreateView', vi.fn(() => {
    createViewCalls++;
    return makeEl('view');
  }));
  vi.stubGlobal('__CreateText', vi.fn(() => makeEl('text')));
  vi.stubGlobal('__CreateRawText', vi.fn(() => makeEl('raw-text')));
  vi.stubGlobal('__CreateElement', vi.fn((tag: string) => makeEl(tag)));
  vi.stubGlobal('__AppendElement', vi.fn((parent: FakeEl, child: FakeEl) => {
    parent.children.push(child);
  }));
  vi.stubGlobal('__InsertElementBefore', vi.fn());
  vi.stubGlobal('__RemoveElement', vi.fn((parent: FakeEl, child: FakeEl) => {
    parent.children = parent.children.filter((c) => c !== child);
  }));
  vi.stubGlobal('__SetCSSId', vi.fn());
  vi.stubGlobal('__SetAttribute', vi.fn((_el: FakeEl, key: string, value: unknown) => {
    if (key === 'text') textWrites.push(value);
  }));
  vi.stubGlobal('__SetInlineStyles', vi.fn());
  vi.stubGlobal('__SetClasses', vi.fn());
  vi.stubGlobal('__SetID', vi.fn());
  vi.stubGlobal('__AddEvent', vi.fn());
  vi.stubGlobal('__FlushElementTree', vi.fn());
  vi.stubGlobal('__GetElementUniqueID', vi.fn((el: FakeEl) => el.__id));

  setSnapshotPageId(7);
  const page = makeEl('page');
  elements.set(1, page as never);
  setPlaceholder(page as never, makeEl('placeholder') as never);
});

function registerTemplate(id: string): void {
  snapshotCreatorMap[id] = (uid) =>
    createSnapshot(
      uid,
      function () {
        const el0 = __CreateView(__pageId) as unknown as FakeEl;
        const el1 = __CreateText(__pageId) as unknown as FakeEl;
        __AppendElement(el0 as never, el1 as never);
        return [el0, el1] as unknown[];
      } as never,
      [
        (ctx, index) => {
          if (ctx.__elements) {
            __SetAttribute(ctx.__elements[1] as never, 'text', ctx.__values[index]);
          }
        },
      ],
      [[6, 1]],
      undefined,
      undefined,
      null,
      true,
    );
}

describe('purgeSnapshotTemplatesByPrefix', () => {
  it('purges same-file stale ids, keeps incoming and other files', () => {
    registerTemplate('__snapshot_aaaa_old1_1');
    registerTemplate('__snapshot_aaaa_old1_2');
    registerTemplate('__snapshot_bbbb_zzz_1'); // other file — untouched
    // Resolve one into the manager to prove both registries purge.
    expect(getSnapshotDef('__snapshot_aaaa_old1_1')).toBeDefined();

    const purged = purgeSnapshotTemplatesByPrefix([
      '__snapshot_aaaa_new2_1', // the edit's incoming id (same file prefix)
    ]);
    expect(purged).toBeGreaterThanOrEqual(2);
    expect(isSnapshotType('__snapshot_aaaa_old1_1')).toBe(false);
    expect(isSnapshotType('__snapshot_aaaa_old1_2')).toBe(false);
    expect(snapshotManager.values.has('__snapshot_aaaa_old1_1')).toBe(false);
    expect(isSnapshotType('__snapshot_bbbb_zzz_1')).toBe(true);
  });

  it('keeps incoming ids that already exist (unchanged templates)', () => {
    registerTemplate('__snapshot_cccc_same_1');
    const purged = purgeSnapshotTemplatesByPrefix(['__snapshot_cccc_same_1']);
    expect(purged).toBe(0);
    expect(isSnapshotType('__snapshot_cccc_same_1')).toBe(true);
  });

  it('no-ops on an empty incoming set', () => {
    registerTemplate('__snapshot_dddd_x_1');
    expect(purgeSnapshotTemplatesByPrefix([])).toBe(0);
    expect(isSnapshotType('__snapshot_dddd_x_1')).toBe(true);
  });
});

describe('park-and-retry', () => {
  const TPL = '__snapshot_hmr_park_1';

  it('parks an unknown-template create, queues its ops, replays after registration', () => {
    applyOps([
      OP.SNAPSHOT_CREATE, 30, TPL,
      OP.SNAPSHOT_SET_VALUES, 30, ['queued-text'],
      OP.INSERT, 1, 30, -1,
    ]);
    expect(isParkedSnapshot(30)).toBe(true);
    expect(isSnapshotInstance(30)).toBe(false);
    expect(createViewCalls).toBe(0);

    registerTemplate(TPL);
    retryParkedSnapshots(applyOps);

    expect(isParkedSnapshot(30)).toBe(false);
    expect(isSnapshotInstance(30)).toBe(true);
    expect(createViewCalls).toBe(1);
    expect(textWrites).toEqual(['queued-text']); // staged value replayed
    const page = elements.get(1) as unknown as FakeEl;
    expect(page.children.some((c) => c.tag === 'view')).toBe(true); // INSERT replayed
  });

  it('REMOVE of a parked id drops it — retry does nothing', () => {
    applyOps([
      OP.SNAPSHOT_CREATE, 31, TPL,
      OP.REMOVE, 1, 31,
    ]);
    expect(isParkedSnapshot(31)).toBe(false);
    registerTemplate(TPL);
    retryParkedSnapshots(applyOps);
    expect(isSnapshotInstance(31)).toBe(false);
    expect(createViewCalls).toBe(0);
  });

  it('drops a parked create after aging out, with a loud log', () => {
    applyOps([OP.SNAPSHOT_CREATE, 32, '__snapshot_never_arrives_1']);
    expect(isParkedSnapshot(32)).toBe(true);
    retryParkedSnapshots(applyOps);
    retryParkedSnapshots(applyOps);
    retryParkedSnapshots(applyOps);
    expect(isParkedSnapshot(32)).toBe(false);
    expect(logs.some((l) => l.includes('dropping parked instance 32'))).toBe(true);
  });

  it('reset clears parked state', () => {
    applyOps([OP.SNAPSHOT_CREATE, 33, '__snapshot_reset_case_1']);
    expect(isParkedSnapshot(33)).toBe(true);
    resetSnapshotInstances();
    expect(isParkedSnapshot(33)).toBe(false);
  });
});
