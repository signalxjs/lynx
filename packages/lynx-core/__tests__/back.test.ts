/** Back interceptors (#1290): newest first, first `true` consumes. */
import { afterEach, describe, expect, it } from 'vitest';
import { effect } from '@sigx/reactivity';
import { addBackInterceptor, dispatchBackInterceptors, hasBackInterceptors } from '../src/index';

const offs: Array<() => void> = [];
const add = (fn: () => boolean): (() => void) => {
    const off = addBackInterceptor(fn);
    offs.push(off);
    return off;
};

afterEach(() => {
    while (offs.length) offs.pop()!();
});

describe('back interceptors', () => {
    it('is unconsumed with nothing registered', () => {
        expect(dispatchBackInterceptors()).toBe(false);
    });

    it('runs newest first and stops at the first that consumes', () => {
        const order: string[] = [];
        add(() => { order.push('old'); return true; });
        add(() => { order.push('new'); return true; });
        expect(dispatchBackInterceptors()).toBe(true);
        expect(order).toEqual(['new']);
    });

    it('falls through interceptors that decline', () => {
        const order: string[] = [];
        add(() => { order.push('old'); return true; });
        add(() => { order.push('new'); return false; });
        expect(dispatchBackInterceptors()).toBe(true);
        expect(order).toEqual(['new', 'old']);
    });

    it('unsubscribes idempotently, one entry per registration', () => {
        const fn = (): boolean => true;
        const a = add(fn);
        const b = add(fn);
        a();
        a();
        expect(dispatchBackInterceptors()).toBe(true);
        b();
        expect(dispatchBackInterceptors()).toBe(false);
    });

    it('lets an interceptor unregister itself mid-dispatch', () => {
        const order: string[] = [];
        add(() => { order.push('below'); return false; });
        const off = add(() => { order.push('top'); off(); return false; });
        expect(dispatchBackInterceptors()).toBe(false);
        expect(order).toEqual(['top', 'below']);
    });

    it('skips a throwing interceptor instead of swallowing the press', () => {
        add(() => true);
        add(() => { throw new Error('boom'); });
        expect(dispatchBackInterceptors()).toBe(true);
    });

    it('hasBackInterceptors is a reactive read of whether any is registered (#1312)', () => {
        const seen: boolean[] = [];
        const runner = effect(() => {
            seen.push(hasBackInterceptors());
        });
        const offA = add(() => true);
        const offB = add(() => true);
        offA();
        offB();
        offB();
        runner.stop();
        // One flip each way: registering a second one, or unregistering
        // twice, does not change the answer.
        expect(seen).toEqual([false, true, false]);
    });
});
