/**
 * #863 — upstream's worklet `Element.prototype.invoke` rejects inside its own
 * Promise executor. `__InvokeUIMethod` answers synchronously for the everyday
 * native "no" cases, so under PrimJS the rejection is reported as unhandled —
 * and escalated to a fatal main-thread exception — before the caller's
 * `.catch()` on the next statement can run.
 *
 * These tests model upstream's class exactly (same executor-time rejection,
 * same `element` field) and pin that the patch defers the rejection without
 * changing anything else about the contract.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  patchUpstreamInvoke,
  __resetUpstreamInvokePatchForTest,
} from '../src/upstream-invoke-patch';

/** Verbatim shape of `@lynx-js/react`'s worklet Element (0.121.0). */
class UpstreamElementStub {
  element: unknown;
  flushed = 0;

  constructor(element: unknown) {
    this.element = element;
  }

  invoke(methodName: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      __InvokeUIMethod(this.element as never, methodName, params ?? {}, (res) => {
        if (res.code === 0) resolve(res.data);
        else reject(new Error('UI method invoke: ' + JSON.stringify(res)));
      });
      this.flushElementTree();
    });
  }

  flushElementTree(): void {
    this.flushed++;
  }
}

/** Native answers inline — the real Android behavior for a duplicate scroll. */
const DUPLICATE = { code: 1, data: 'dumplicated, scrollToPositionSmoothly is working' };

beforeEach(() => {
  __resetUpstreamInvokePatchForTest();
  vi.stubGlobal('__InvokeUIMethod', vi.fn((_el, method: string, _params, cb: (r: unknown) => void) => {
    cb(method === 'ok' ? { code: 0, data: 'fine' } : DUPLICATE);
  }));
});

/** Resolves to the order in which the two reactions actually ran. */
async function rejectionOrder(el: { invoke(m: string): Promise<unknown> }): Promise<string[]> {
  const order: string[] = [];
  const p = el.invoke('scrollToPosition');
  // Exactly what every call site does — guard on the very next statement.
  p.catch(() => { order.push('invoke-rejected'); });
  void Promise.resolve().then(() => { order.push('marker'); });
  await new Promise((r) => setTimeout(r, 0));
  return order;
}

describe('patchUpstreamInvoke', () => {
  it('the unpatched upstream implementation rejects before the caller can guard', async () => {
    // Baseline: an already-rejected promise enqueues its reaction the instant a
    // handler is attached, so it lands AHEAD of the marker. Under PrimJS that
    // ordering is what makes the guard useless — the engine has already fired.
    const el = new UpstreamElementStub({ id: 1 });
    expect(await rejectionOrder(el)).toEqual(['invoke-rejected', 'marker']);
  });

  it('defers the rejection past the synchronous caller', async () => {
    const el = new UpstreamElementStub({ id: 1 });
    patchUpstreamInvoke(el);
    expect(await rejectionOrder(el)).toEqual(['marker', 'invoke-rejected']);
  });

  it('patches the prototype, so refs bound before the patch are covered too', async () => {
    const earlier = new UpstreamElementStub({ id: 1 });
    patchUpstreamInvoke(new UpstreamElementStub({ id: 2 }));
    expect(await rejectionOrder(earlier)).toEqual(['marker', 'invoke-rejected']);
  });

  it('still rejects the caller with the native response', async () => {
    const el = new UpstreamElementStub({ id: 1 });
    patchUpstreamInvoke(el);
    await expect(el.invoke('scrollToPosition')).rejects.toThrow(
      /UI method invoke: .*scrollToPositionSmoothly is working/,
    );
  });

  it('still resolves with res.data and still flushes the element tree', async () => {
    const el = new UpstreamElementStub({ id: 1 });
    patchUpstreamInvoke(el);
    await expect(el.invoke('ok')).resolves.toBe('fine');
    expect(el.flushed).toBe(1);
  });

  it('forwards params, defaulting to {}', async () => {
    const el = new UpstreamElementStub({ id: 7 });
    patchUpstreamInvoke(el);
    await el.invoke('ok');
    await (el as unknown as { invoke(m: string, p: unknown): Promise<unknown> })
      .invoke('ok', { position: 3 });
    const calls = (__InvokeUIMethod as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls[0]![0]).toEqual({ id: 7 });
    expect(calls[0]![2]).toEqual({});
    expect(calls[1]![2]).toEqual({ position: 3 });
  });

  it('applies at most once', () => {
    const el = new UpstreamElementStub({ id: 1 });
    patchUpstreamInvoke(el);
    const first = Object.getPrototypeOf(el).invoke;
    patchUpstreamInvoke(new UpstreamElementStub({ id: 2 }));
    expect(Object.getPrototypeOf(el).invoke).toBe(first);
  });

  it('leaves objects of an unexpected shape alone', async () => {
    // No `element` field → not upstream's Element. Degrade to unpatched rather
    // than install an `invoke` that would call `__InvokeUIMethod(undefined)`.
    class Foreign {
      invoke(): Promise<unknown> { return Promise.resolve('untouched'); }
    }
    const foreign = new Foreign();
    patchUpstreamInvoke(foreign);
    await expect(foreign.invoke()).resolves.toBe('untouched');

    // …and the real patch still applies afterwards.
    const el = new UpstreamElementStub({ id: 1 });
    patchUpstreamInvoke(el);
    expect(await rejectionOrder(el)).toEqual(['marker', 'invoke-rejected']);
  });

  it('ignores null / non-objects', () => {
    expect(() => { patchUpstreamInvoke(null); }).not.toThrow();
    expect(() => { patchUpstreamInvoke(undefined); }).not.toThrow();
    expect(() => { patchUpstreamInvoke(42); }).not.toThrow();
  });
});
