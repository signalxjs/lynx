/**
 * `Updates.addListener` disposer semantics (C7).
 *
 * These assert on this package's own fan-out — no emitter stand-in is
 * involved, so nothing here can pass by agreeing with a mock. Every test
 * starts from `__resetForTests()`, so the module-level listener set is not
 * shared state carried in from another test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Updates } from '../src/index';
import { emit, __resetForTests } from '../src/state';
import type { UpdatesEvent } from '../src/types';

const EVENT: UpdatesEvent = { type: 'checkStarted' };

beforeEach(() => {
    __resetForTests();
    vi.restoreAllMocks();
});

describe('Updates.addListener disposer (C7)', () => {
    it('returns a bare function, not a { remove() } subscription object', () => {
        const off = Updates.addListener(() => {});
        expect(typeof off).toBe('function');
        expect(off).not.toHaveProperty('remove');
        off();
    });

    it('disposing twice leaves a second subscriber receiving events', () => {
        const a: UpdatesEvent[] = [];
        const b: UpdatesEvent[] = [];
        const offA = Updates.addListener((e) => a.push(e));
        Updates.addListener((e) => b.push(e));

        offA();
        offA();

        emit(EVENT);
        expect(a).toEqual([]);
        expect(b).toEqual([EVENT]);
    });

    it('keeps two subscribers apart when they share one handler function', () => {
        // The realistic shape: a module-level `logUpdate` subscribed by two
        // components. Keying registrations on the callback collapses them into
        // one, and the first unmount then silently deafens the other — no
        // error, events just stop.
        const seen: UpdatesEvent[] = [];
        const handler = (e: UpdatesEvent) => { seen.push(e); };
        const offFirst = Updates.addListener(handler);
        Updates.addListener(handler);

        offFirst();

        emit(EVENT);
        expect(seen).toEqual([EVENT]);
    });

    it('does not let a stale disposer unsubscribe a later re-subscription', () => {
        const seen: UpdatesEvent[] = [];
        const handler = (e: UpdatesEvent) => { seen.push(e); };
        const offFirst = Updates.addListener(handler);
        offFirst();

        Updates.addListener(handler);
        offFirst();                     // stale — must not touch the new one

        emit(EVENT);
        expect(seen).toEqual([EVENT]);
    });

    it('contains a throwing listener so later subscribers still run', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const seen: UpdatesEvent[] = [];
        Updates.addListener(() => { throw new Error('consumer bug'); });
        Updates.addListener((e) => seen.push(e));

        expect(() => emit(EVENT)).not.toThrow();
        expect(seen).toEqual([EVENT]);
    });

    it('delivers to every distinct subscriber', () => {
        let n = 0;
        Updates.addListener(() => { n++; });
        Updates.addListener(() => { n++; });
        Updates.addListener(() => { n++; });

        emit(EVENT);
        expect(n).toBe(3);
    });
});
