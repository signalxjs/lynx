/**
 * CONVENTIONS.md C10 asks diagnostics to go through `createLogger('<pkg>')`
 * instead of bare `console.*`. This package is the Main Thread (Lepus) bundle
 * and it declines that rule — these tests are the evidence, so a future sweep
 * doesn't "finish the migration" and break gesture handlers.
 *
 * Two independent reasons:
 *
 *  1. A `Logger` cannot reach a `'main thread'` worklet body. `createLogger`
 *     returns an object of CLOSURES over `@sigx/lynx-core`'s module state.
 *     The SWC worklet transform does not leave a module-scope reference in
 *     place — it rewrites `log.warn(x)` into a `_c` capture and the body
 *     reads `this._c`. Verified against the real transform:
 *
 *         export function onScroll(e) { 'main thread'; log.warn('s', e); }
 *       ⇒ export let onScroll = { _c: { log: { warn: log.warn } }, _wkltId: … };
 *         registerWorkletInternal("main-thread", …, function (e) {
 *           let { log } = this["_c"]; log.warn('s', e);   // ← _c, not module scope
 *         });
 *
 *     `_c` then crosses BG→MT as JSON (`lynx-runtime/src/op-queue.ts:133`),
 *     and `JSON.stringify` drops function-valued properties. So the capture
 *     arrives as `{}` and the FIRST log line in the worklet throws a
 *     TypeError — turning a diagnostic into a dead scroll/gesture handler.
 *
 *  2. Even in plain (non-worklet) MT module code, `createLogger` would be
 *     strictly equal to `console.*`: the only transports that make the logger
 *     worth anything — `@sigx/lynx-dev-client/install` (the `sigx dev`
 *     console streamer) and `@sigx/lynx-observability/install` — are
 *     prepended to `LAYERS.BACKGROUND` only (`lynx-plugin/src/entry.ts:747`
 *     and `:759`). The MT layer's entry list is user imports plus the CSS HMR
 *     runtime; nothing patches the Lepus console. That one is a build-config
 *     fact, not a runtime one, so it is recorded in the README's Gotchas
 *     section rather than asserted here.
 *
 * There is also a plain cost argument: `@sigx/lynx-core` publishes no logger
 * subpath (only the barrel), so importing it would drag `@sigx/reactivity`
 * and the whole native bridge into a bundle whose stated job is "PAPI
 * bootstrap only" (`lynx-plugin/src/entry.ts:668`).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { OP } from '@sigx/lynx-runtime-internal';
import { applyOps, resetMainThreadState } from '../src/ops-apply';
import { rebuildWithObjectPrototype } from '../src/mt-invoke';

/** Shape `createLogger('x')` returns — an object of closures. */
function makeLogger(sink: unknown[][]) {
  return {
    warn: (msg: string, ...fields: unknown[]) => sink.push([msg, ...fields]),
    error: (msg: string, ...fields: unknown[]) => sink.push([msg, ...fields]),
    enabled: () => true,
  };
}

beforeEach(() => {
  resetMainThreadState();
  vi.unstubAllGlobals();
  vi.stubGlobal('__FlushElementTree', vi.fn());
});

describe('a captured Logger cannot survive BG → MT (C10 exemption evidence)', () => {
  it('JSON transport strips the logger methods out of the worklet capture', () => {
    const sink: unknown[][] = [];
    const log = makeLogger(sink);

    // Exactly what the SWC worklet transform emits for a body that calls
    // `log.warn(...)`: a narrowed capture holding the bound method.
    const capturedOnBg = { log: { warn: log.warn }, tag: '[sigx-mt]' };
    expect(typeof capturedOnBg.log.warn).toBe('function');

    // BG → MT is `JSON.stringify(ops)` (lynx-runtime/src/op-queue.ts:133),
    // decoded by `sigxPatchUpdate`.
    const arrived = JSON.parse(JSON.stringify(capturedOnBg)) as typeof capturedOnBg;

    expect(arrived.tag).toBe('[sigx-mt]'); // plain data survives
    expect(arrived.log).toEqual({}); // the closures do not
    expect(typeof arrived.log.warn).toBe('undefined');
    expect(sink).toHaveLength(0);
  });

  it('rebuildWithObjectPrototype does not resurrect them either', () => {
    const sink: unknown[][] = [];
    const arrived = JSON.parse(
      JSON.stringify({ log: { warn: makeLogger(sink).warn } }),
    ) as { log: { warn?: unknown } };

    const rebuilt = rebuildWithObjectPrototype(arrived);

    expect(typeof rebuilt.log.warn).toBe('undefined');
  });

  it('the worklet body throws on its first log line, killing the handler', () => {
    const sink: unknown[][] = [];
    const log = makeLogger(sink);
    const ran: string[] = [];

    // The registered MT body as the transform writes it: destructure `_c`,
    // then log. Nothing here can see the BG module scope.
    const workletMap: Record<string, (...a: unknown[]) => unknown> = {
      onScroll: function (this: { _c: { log: { warn?: (m: string) => void } } }) {
        ran.push('entered'); // proves the invoke path reached the body at all
        const { log: mtLog } = this._c;
        mtLog.warn!('scrolled'); // ← TypeError: mtLog.warn is not a function
        ran.push('did-real-work');
      },
    };
    vi.stubGlobal('lynxWorkletImpl', {
      _workletMap: workletMap,
      _refImpl: { _workletRefMap: {} },
    });
    vi.stubGlobal('runWorklet', (
      p: { _wkltId: string; _c?: Record<string, unknown> },
      args: unknown[],
    ) => workletMap[p._wkltId]!.apply({ _c: p._c }, args));

    const wire = JSON.stringify([
      OP.INVOKE_WORKLET, 'onScroll', [], { log: { warn: log.warn } },
    ]);

    // Contained by `invokeMtWorklet`, so the batch survives — but the body
    // aborts AT the log line: it is entered, and everything after the
    // diagnostic is dead. Nothing was logged anywhere.
    expect(() => applyOps(JSON.parse(wire) as unknown[])).not.toThrow();
    expect(ran).toEqual(['entered']);
    expect(sink).toHaveLength(0);
  });

  it('a bare console.* call in the same body is untouched by the transport', () => {
    // The control arm: `console` is a realm global on Lepus, never a capture,
    // so it needs nothing from `_c` and the handler completes.
    const logged: unknown[][] = [];
    const ran: string[] = [];
    vi.stubGlobal('console', { ...console, log: (...a: unknown[]) => logged.push(a) });

    const workletMap: Record<string, (...a: unknown[]) => unknown> = {
      onScroll: function (this: { _c: Record<string, unknown> }) {
        console.log('[sigx-mt] scrolled', this._c['tag']);
        ran.push('did-real-work');
      },
    };
    vi.stubGlobal('lynxWorkletImpl', {
      _workletMap: workletMap,
      _refImpl: { _workletRefMap: {} },
    });
    vi.stubGlobal('runWorklet', (
      p: { _wkltId: string; _c?: Record<string, unknown> },
      args: unknown[],
    ) => workletMap[p._wkltId]!.apply({ _c: p._c }, args));

    const wire = JSON.stringify([OP.INVOKE_WORKLET, 'onScroll', [], { tag: 't' }]);
    applyOps(JSON.parse(wire) as unknown[]);

    expect(ran).toEqual(['did-real-work']);
    expect(logged).toEqual([['[sigx-mt] scrolled', 't']]);
  });
});
