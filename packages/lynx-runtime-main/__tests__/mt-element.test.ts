/**
 * Tests for MTElementWrapper — the high-level wrapper that user code drives
 * via `ref.current?.method()` inside `'main thread'` worklets.
 *
 * The wrapper is a thin shell over Lynx PAPI globals (__GetAttributeByName,
 * __InvokeUIMethod, etc.). We mock the globals on globalThis, drive the
 * wrapper, and assert the PAPI was called with the right shape.
 *
 * Methods covered (Phase 1d parity items, mirroring upstream's Element):
 *   getAttribute, getAttributeNames, querySelector, querySelectorAll, invoke,
 *   getComputedStyleProperty (now wired to __GetComputedStyleByKey).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { MTElementWrapper } from '../src/mt-element.js';

interface Calls {
  GetAttributeByName: Array<{ el: unknown; name: string }>;
  GetAttributeNames: Array<{ el: unknown }>;
  GetComputedStyleByKey: Array<{ el: unknown; key: string }>;
  QuerySelector: Array<{ el: unknown; selector: string; options: object }>;
  QuerySelectorAll: Array<{ el: unknown; selector: string; options: object }>;
  InvokeUIMethod: Array<{
    el: unknown;
    method: string;
    params: object;
    callback: (res: { code: number; data: unknown }) => void;
  }>;
  FlushElementTree: number;
}

const calls: Calls = {
  GetAttributeByName: [],
  GetAttributeNames: [],
  GetComputedStyleByKey: [],
  QuerySelector: [],
  QuerySelectorAll: [],
  InvokeUIMethod: [],
  FlushElementTree: 0,
};

beforeEach(() => {
  Object.assign(calls, {
    GetAttributeByName: [],
    GetAttributeNames: [],
    GetComputedStyleByKey: [],
    QuerySelector: [],
    QuerySelectorAll: [],
    InvokeUIMethod: [],
    FlushElementTree: 0,
  });
  vi.stubGlobal('__GetAttributeByName', vi.fn((el: unknown, name: string) => {
    calls.GetAttributeByName.push({ el, name });
    return name === 'foo' ? 'bar' : undefined;
  }));
  vi.stubGlobal('__GetAttributeNames', vi.fn((el: unknown) => {
    calls.GetAttributeNames.push({ el });
    return ['foo', 'baz'];
  }));
  vi.stubGlobal('__GetComputedStyleByKey', vi.fn((el: unknown, key: string) => {
    calls.GetComputedStyleByKey.push({ el, key });
    return key === 'background-color' ? 'rgb(255, 0, 0)' : '';
  }));
  vi.stubGlobal('__QuerySelector', vi.fn((el: unknown, selector: string, options: object) => {
    calls.QuerySelector.push({ el, selector, options });
    return selector === '.match' ? ({ __brand: 'MainThreadElement' } as unknown) : null;
  }));
  vi.stubGlobal('__QuerySelectorAll', vi.fn((el: unknown, selector: string, options: object) => {
    calls.QuerySelectorAll.push({ el, selector, options });
    return selector === '.many'
      ? [{ __brand: 'MainThreadElement' }, { __brand: 'MainThreadElement' }]
      : [];
  }));
  vi.stubGlobal('__InvokeUIMethod', vi.fn((el, method, params, callback) => {
    calls.InvokeUIMethod.push({ el, method, params, callback });
  }));
  vi.stubGlobal('__FlushElementTree', vi.fn(() => {
    calls.FlushElementTree++;
  }));
  // Write PAPIs the wrapper calls before flushing — no-op stubs are fine,
  // we don't assert on them in this file.
  vi.stubGlobal('__SetInlineStyles', vi.fn());
  vi.stubGlobal('__AddInlineStyle', vi.fn());
  vi.stubGlobal('__SetAttribute', vi.fn());
});

const fakeEl = { __brand: 'MainThreadElement' } as unknown as ConstructorParameters<
  typeof MTElementWrapper
>[0];

describe('MTElementWrapper.getAttribute', () => {
  it('delegates to __GetAttributeByName and returns the value', () => {
    const w = new MTElementWrapper(fakeEl);
    expect(w.getAttribute('foo')).toBe('bar');
    expect(calls.GetAttributeByName).toEqual([{ el: fakeEl, name: 'foo' }]);
  });

  it('returns undefined when the PAPI is missing', () => {
    vi.stubGlobal('__GetAttributeByName', undefined);
    const w = new MTElementWrapper(fakeEl);
    expect(w.getAttribute('foo')).toBeUndefined();
  });
});

describe('MTElementWrapper.getAttributeNames', () => {
  it('returns the PAPI list', () => {
    const w = new MTElementWrapper(fakeEl);
    expect(w.getAttributeNames()).toEqual(['foo', 'baz']);
  });

  it('returns [] when the PAPI is missing', () => {
    vi.stubGlobal('__GetAttributeNames', undefined);
    const w = new MTElementWrapper(fakeEl);
    expect(w.getAttributeNames()).toEqual([]);
  });
});

describe('MTElementWrapper.getComputedStyleProperty', () => {
  it('routes through __GetComputedStyleByKey', () => {
    const w = new MTElementWrapper(fakeEl);
    expect(w.getComputedStyleProperty('background-color')).toBe('rgb(255, 0, 0)');
    expect(calls.GetComputedStyleByKey).toEqual([
      { el: fakeEl, key: 'background-color' },
    ]);
  });
});

describe('MTElementWrapper.querySelector', () => {
  it('wraps the matched element', () => {
    const w = new MTElementWrapper(fakeEl);
    const result = w.querySelector('.match');
    expect(result).toBeInstanceOf(MTElementWrapper);
  });

  it('returns null when no match', () => {
    const w = new MTElementWrapper(fakeEl);
    expect(w.querySelector('.miss')).toBeNull();
  });

  it('passes selector + empty options to __QuerySelector', () => {
    const w = new MTElementWrapper(fakeEl);
    w.querySelector('.match');
    expect(calls.QuerySelector).toEqual([
      { el: fakeEl, selector: '.match', options: {} },
    ]);
  });

  it('returns null when PAPI missing', () => {
    vi.stubGlobal('__QuerySelector', undefined);
    const w = new MTElementWrapper(fakeEl);
    expect(w.querySelector('.match')).toBeNull();
  });
});

describe('MTElementWrapper.querySelectorAll', () => {
  it('wraps each matched element', () => {
    const w = new MTElementWrapper(fakeEl);
    const result = w.querySelectorAll('.many');
    expect(result).toHaveLength(2);
    expect(result.every((r) => r instanceof MTElementWrapper)).toBe(true);
  });

  it('returns [] when nothing matches', () => {
    const w = new MTElementWrapper(fakeEl);
    expect(w.querySelectorAll('.none')).toEqual([]);
  });

  it('returns [] when PAPI missing', () => {
    vi.stubGlobal('__QuerySelectorAll', undefined);
    const w = new MTElementWrapper(fakeEl);
    expect(w.querySelectorAll('.many')).toEqual([]);
  });
});

describe('MTElementWrapper.invoke', () => {
  it('resolves with res.data when code === 0', async () => {
    const w = new MTElementWrapper(fakeEl);
    const promise = w.invoke('scrollIntoView', { index: 5 });
    // Drive the captured callback
    expect(calls.InvokeUIMethod).toHaveLength(1);
    calls.InvokeUIMethod[0]!.callback({ code: 0, data: { ok: true } });
    await expect(promise).resolves.toEqual({ ok: true });
  });

  it('rejects when code !== 0', async () => {
    const w = new MTElementWrapper(fakeEl);
    const promise = w.invoke('scrollToBadIndex');
    calls.InvokeUIMethod[0]!.callback({ code: 1, data: 'bad index' });
    await expect(promise).rejects.toThrow(/UI method invoke/);
  });

  it('passes empty params when none given, and flushes the tree (debounced)', async () => {
    const w = new MTElementWrapper(fakeEl);
    void w.invoke('scrollToTop');
    expect(calls.InvokeUIMethod[0]!.method).toBe('scrollToTop');
    expect(calls.InvokeUIMethod[0]!.params).toEqual({});
    // Flush is microtask-debounced — not yet fired.
    expect(calls.FlushElementTree).toBe(0);
    // Drain the microtask queue.
    await Promise.resolve();
    expect(calls.FlushElementTree).toBe(1);
  });

  it('coalesces multiple writes within the same microtask into a single flush', async () => {
    const w = new MTElementWrapper(fakeEl);
    w.setStyleProperties({ opacity: 0.5 });
    w.setStyleProperty('color', 'red');
    w.setAttribute('data-x', '1');
    void w.invoke('scrollToTop');
    // All four writes scheduled — still no flush.
    expect(calls.FlushElementTree).toBe(0);
    // Drain the microtask queue: exactly ONE native flush for the four writes.
    await Promise.resolve();
    expect(calls.FlushElementTree).toBe(1);
  });

  it('rejects immediately when PAPI missing', async () => {
    vi.stubGlobal('__InvokeUIMethod', undefined);
    const w = new MTElementWrapper(fakeEl);
    await expect(w.invoke('missing')).rejects.toThrow(/not available/);
  });
});
