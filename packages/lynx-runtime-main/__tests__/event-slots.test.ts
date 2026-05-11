/**
 * Tests for the MT-side per-slot event registration state machine.
 *
 * The slot machine defers __AddEvent until end-of-batch and combines a worklet
 * + BG sign on the same (el, type, name) into a single hybrid worklet
 * registration. Tests mock `__AddEvent` and seed the element registry, then
 * drive setSlotWorklet/setSlotBgSign + flushDirtySlots and assert what
 * __AddEvent was called with.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { elements } from '../src/element-registry.js';
import {
  setSlotWorklet,
  setSlotBgSign,
  flushDirtySlots,
  resetSlotStates,
} from '../src/event-slots.js';
import { HYBRID_WORKLET_ID } from '../src/hybrid-worklet.js';
import type { WorkletPlaceholder } from '../src/worklet-events.js';

// Mock __AddEvent — capture calls for assertions.
const addEventCalls: Array<{
  el: unknown;
  type: string;
  name: string;
  value: unknown;
}> = [];

beforeEach(() => {
  addEventCalls.length = 0;
  resetSlotStates();
  elements.clear();
  // Seed a fake element under id 42 so flushDirtySlots can resolve it.
  elements.set(42, { __brand: 'el42' } as never);
  vi.stubGlobal('__AddEvent', (el: unknown, type: string, name: string, value: unknown) => {
    addEventCalls.push({ el, type, name, value });
  });
});

const wkltA: WorkletPlaceholder = { _wkltId: 'wA', _c: { x: 1 } };
const wkltB: WorkletPlaceholder = { _wkltId: 'wB' };

describe('event-slots', () => {
  it('BG-only sign installs as the raw sign string', () => {
    setSlotBgSign(42, 'bindEvent', 'tap', 'sigx:7');
    flushDirtySlots();

    expect(addEventCalls).toHaveLength(1);
    expect(addEventCalls[0]).toMatchObject({
      type: 'bindEvent',
      name: 'tap',
      value: 'sigx:7',
    });
  });

  it('MT-only worklet installs as { type:"worklet", value: ctx }', () => {
    setSlotWorklet(42, 'bindEvent', 'tap', wkltA);
    flushDirtySlots();

    expect(addEventCalls).toHaveLength(1);
    const v = addEventCalls[0]!.value as { type: string; value: WorkletPlaceholder };
    expect(v.type).toBe('worklet');
    expect(v.value._wkltId).toBe('wA');
  });

  it('both worklet + bgSign on the same slot install ONE hybrid registration', () => {
    setSlotWorklet(42, 'bindEvent', 'tap', wkltA);
    setSlotBgSign(42, 'bindEvent', 'tap', 'sigx:9');
    flushDirtySlots();

    expect(addEventCalls).toHaveLength(1); // critical: one __AddEvent, not two
    const v = addEventCalls[0]!.value as {
      type: string;
      value: { _wkltId: string; _c: { realCtx: WorkletPlaceholder; bgSign: string } };
    };
    expect(v.type).toBe('worklet');
    expect(v.value._wkltId).toBe(HYBRID_WORKLET_ID);
    expect(v.value._c.realCtx._wkltId).toBe('wA');
    expect(v.value._c.bgSign).toBe('sigx:9');
  });

  it('re-render with same worklet + new bgSign re-installs the hybrid ctx', () => {
    // First batch: hybrid installed.
    setSlotWorklet(42, 'bindEvent', 'tap', wkltA);
    setSlotBgSign(42, 'bindEvent', 'tap', 'sigx:9');
    flushDirtySlots();
    expect(addEventCalls).toHaveLength(1);

    // Second batch: BG sign changes; worklet untouched (BG re-render of a
    // re-bound handler keeps the same sign in real life, but exercise the
    // re-install path explicitly).
    setSlotBgSign(42, 'bindEvent', 'tap', 'sigx:10');
    flushDirtySlots();
    expect(addEventCalls).toHaveLength(2);
    const v = addEventCalls[1]!.value as {
      value: { _c: { realCtx: WorkletPlaceholder; bgSign: string } };
    };
    expect(v.value._c.realCtx._wkltId).toBe('wA');
    expect(v.value._c.bgSign).toBe('sigx:10');
  });

  it('removing the BG handler reverts the slot to MT-only worklet ctx', () => {
    setSlotWorklet(42, 'bindEvent', 'tap', wkltB);
    setSlotBgSign(42, 'bindEvent', 'tap', 'sigx:11');
    flushDirtySlots();
    expect(addEventCalls).toHaveLength(1);

    setSlotBgSign(42, 'bindEvent', 'tap', undefined);
    flushDirtySlots();
    expect(addEventCalls).toHaveLength(2);
    const v = addEventCalls[1]!.value as { type: string; value: WorkletPlaceholder };
    expect(v.type).toBe('worklet');
    expect(v.value._wkltId).toBe('wB'); // back to plain worklet, not hybrid
  });

  it('removing both handlers calls __AddEvent with undefined (unregisters)', () => {
    setSlotBgSign(42, 'bindEvent', 'tap', 'sigx:12');
    flushDirtySlots();
    expect(addEventCalls).toHaveLength(1);

    setSlotBgSign(42, 'bindEvent', 'tap', undefined);
    flushDirtySlots();
    expect(addEventCalls[1]!.value).toBeUndefined();
  });

  it('does not re-issue __AddEvent when slot value is unchanged across flushes', () => {
    setSlotBgSign(42, 'bindEvent', 'tap', 'sigx:13');
    flushDirtySlots();
    expect(addEventCalls).toHaveLength(1);

    // Mark dirty without actually changing the value — flush should skip.
    setSlotBgSign(42, 'bindEvent', 'tap', 'sigx:13');
    flushDirtySlots();
    expect(addEventCalls).toHaveLength(1);
  });
});
