/**
 * Load-pipeline forwarding (#982, upstream contract in lynx-family/lynx#8405).
 *
 * Native hands the `loadBundle` pipeline to `renderPage`'s second argument. Our
 * `renderPage` only paints a placeholder — the real tree arrives later over
 * `sigxPatchUpdate` — so the pipeline has to ride the first *ops* flush instead,
 * exactly once. Get that wrong and the engine collects no timing at all: no
 * `PerformanceObserver` entry, no `addTimingListener` callback, no platform
 * perf callbacks, `forceGetPerf()` null.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import { OP } from '@sigx/lynx-runtime-internal';

type FakeEl = { __id: number; tag: string };
let uid = 1;
/** Every `__FlushElementTree` call's arguments, in order. */
let flushCalls: unknown[][] = [];

const makeEl = (tag: string): FakeEl => ({ __id: uid++, tag });

beforeAll(async () => {
  vi.stubGlobal('__CreatePage', () => makeEl('page'));
  vi.stubGlobal('__CreateView', () => makeEl('view'));
  vi.stubGlobal('__SetCSSId', () => {});
  vi.stubGlobal('__GetElementUniqueID', (el: FakeEl) => el.__id);
  vi.stubGlobal('__AppendElement', () => {});
  vi.stubGlobal('__RemoveElement', () => {});
  // Must be stubbed before the import: entry-main's module scope wraps this
  // global (`installAvBridgeFlushHook`), so a later re-stub would be invisible.
  vi.stubGlobal('__FlushElementTree', (...args: unknown[]) => flushCalls.push(args));
  await import('../src/entry-main');
});

beforeEach(() => {
  flushCalls = [];
});

const g = globalThis as unknown as {
  renderPage: (data: unknown, options?: unknown) => void;
  sigxHotReload: () => void;
  sigxPatchUpdate: (payload: { data: string }) => void;
};

const pipelineOptions = {
  pipelineID: 'load-pipeline',
  pipelineOrigin: 'loadBundle',
  needTimestamps: true,
};

/** One harmless op: unregistering a derived value that was never registered. */
const patch = (): void => g.sigxPatchUpdate({ data: JSON.stringify([OP.UNREGISTER_AV_DERIVED, 1]) });

describe('native load pipeline', () => {
  it('rides the first real ops flush, then is gone', () => {
    g.renderPage({}, { pipelineOptions });
    // The placeholder flush must NOT claim it — the pipeline would end on a
    // tree the app never painted.
    expect(flushCalls).toEqual([[expect.objectContaining({ tag: 'page' })]]);

    flushCalls = [];
    patch();
    expect(flushCalls).toEqual([[undefined, { pipelineOptions }]]);

    flushCalls = [];
    patch();
    expect(flushCalls).toEqual([[]]);
  });

  it('is not consumed by an empty batch', () => {
    g.renderPage({}, { pipelineOptions });

    flushCalls = [];
    g.sigxPatchUpdate({ data: '[]' });
    expect(flushCalls).toEqual([]); // an empty batch flushes nothing…

    patch();
    expect(flushCalls).toEqual([[undefined, { pipelineOptions }]]); // …and keeps the pipeline
  });

  it('is dropped by a hot reload rather than re-attributed to it', () => {
    g.renderPage({}, { pipelineOptions });
    g.sigxHotReload();

    flushCalls = [];
    patch();
    expect(flushCalls).toEqual([[]]);
  });

  it('flushes bare when native passes no options (and on web, which passes none)', () => {
    g.renderPage({});

    flushCalls = [];
    patch();
    expect(flushCalls).toEqual([[]]);
  });
});
