/**
 * Tier-2 press feel (#1143): the main-thread half of `createPressFeedback`,
 * compiled the way a real bundle compiles it (the SWC LEPUS worklet
 * transform) and driven with synthetic touch events. What the unit renderer
 * cannot see — it never runs the worklet transform, so it exercises the
 * tier-1 fallback — this harness does: the inline writes on the touched
 * element, the disabled gate, and the hand-off of the pressed flag to the
 * background thread.
 */
import '@sigx/lynx-testing/mt/setup';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compileMTWorklets, getJsContext, makeRef, resetJsContextSpy } from '@sigx/lynx-testing/mt';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src/behaviors/press.ts');
const source = readFileSync(SRC, 'utf8');

// Source order: the transform probe, touch-down, touch-up/cancel, the
// disabled-gate sync.
const [probe, down, up, syncGate] = compileMTWorklets({ filename: SRC, source });

const target = () => ({ setStyleProperties: vi.fn() });
const handle = (id: number) => ({ _jsFnId: id, _execId: 1 });
const bgCalls = (): number[] =>
    (getJsContext().dispatchEvent as ReturnType<typeof vi.fn>).mock.calls
        .map(([e]) => e as { type: string; data: string })
        .filter((e) => e.type === 'Lynx.Sigx.RunOnBackground')
        .map((e) => (JSON.parse(e.data) as { obj: { _jsFnId: number } }).obj._jsFnId);

beforeEach(() => resetJsContextSpy());

describe('createPressFeedback — main-thread worklets', () => {
    it('registers four worklets (probe, down, up, gate sync)', () => {
        expect([probe, down, up, syncGate].every((fn) => typeof fn === 'function')).toBe(true);
    });

    it('touch-down scales the touched element at once and hands the flag to the background', () => {
        const el = target();
        down!.call(
            { _c: { gate: makeRef(false), opacity: -1, scale: 0.97 }, _jsFn: { _jsFn1: handle(7) } },
            { currentTarget: el },
        );
        expect(el.setStyleProperties).toHaveBeenCalledWith({ transform: 'scale(0.97)' });
        expect(bgCalls()).toEqual([7]);
    });

    it('an opted-in opacity rides along, and touch-up restores both', () => {
        const el = target();
        down!.call(
            { _c: { gate: makeRef(false), opacity: 0.85, scale: 0.97 }, _jsFn: { _jsFn1: handle(1) } },
            { currentTarget: el },
        );
        expect(el.setStyleProperties).toHaveBeenLastCalledWith({ transform: 'scale(0.97)', opacity: '0.85' });
        up!.call({ _c: { opacity: 0.85 }, _jsFn: { _jsFn1: handle(2) } }, { currentTarget: el });
        expect(el.setStyleProperties).toHaveBeenLastCalledWith({ transform: 'scale(1)', opacity: '1' });
        expect(bgCalls()).toEqual([1, 2]);
    });

    it('touch-up without opacity restores only the transform', () => {
        const el = target();
        up!.call({ _c: { opacity: -1 }, _jsFn: { _jsFn1: handle(3) } }, { currentTarget: el });
        expect(el.setStyleProperties).toHaveBeenCalledWith({ transform: 'scale(1)' });
        expect(bgCalls()).toEqual([3]);
    });

    it('never presses while disabled: no write, no flag', () => {
        const el = target();
        down!.call(
            { _c: { gate: makeRef(true), opacity: 0.85, scale: 0.97 }, _jsFn: { _jsFn1: handle(4) } },
            { currentTarget: el },
        );
        expect(el.setStyleProperties).not.toHaveBeenCalled();
        expect(bgCalls()).toEqual([]);
    });

    it('the gate sync worklet mirrors disabled onto the main thread', () => {
        const gate = makeRef(false);
        syncGate!.call({ _c: { gate } }, true);
        expect(gate.current).toBe(true);
        const el = target();
        down!.call(
            { _c: { gate, opacity: -1, scale: 0.97 }, _jsFn: { _jsFn1: handle(5) } },
            { currentTarget: el },
        );
        expect(el.setStyleProperties).not.toHaveBeenCalled();
    });

    it('an event with no element still releases the flag', () => {
        up!.call({ _c: { opacity: -1 }, _jsFn: { _jsFn1: handle(6) } }, {});
        expect(bgCalls()).toEqual([6]);
    });
});
