/**
 * The structured device-log store — the thing that exists because
 * `formatDeviceLogLine` destroyed every dimension one line after it arrived.
 *
 * Assertions are on content, matching `device-log.test.ts`; nothing here paints.
 */
import { describe, it, expect } from 'vitest';
import {
    createDeviceLogStore,
    splitNamespace,
    rankOf,
    LEVELS,
} from '../src/dev-ui/device-log-store';
import type { DeviceLogEntry } from '../src/device-log';

function entry(over: Partial<DeviceLogEntry> = {}): DeviceLogEntry {
    return {
        level: 'log',
        args: ['hello'],
        ts: 1_700_000_000_000,
        platform: 'ios',
        client: 1,
        ...over,
    };
}

describe('splitNamespace', () => {
    it('lifts the [ns] the core logger prepends', () => {
        // `createLogger('http').info('→ GET /users')` reaches us as two args.
        expect(splitNamespace(['[http]', '→ GET /users'])).toEqual({
            namespace: 'http',
            rest: ['→ GET /users'],
        });
    });

    it('leaves a bare message alone', () => {
        expect(splitNamespace(['plain message'])).toEqual({
            namespace: null,
            rest: ['plain message'],
        });
    });

    it('does not mine a namespace out of a single bracketed argument', () => {
        // `console.log('[warn] hand-rolled')` is one argument, not a namespaced
        // record — treating it as one would invent a namespace nobody declared.
        expect(splitNamespace(['[warn] hand-rolled'])).toEqual({
            namespace: null,
            rest: ['[warn] hand-rolled'],
        });
    });

    it('ignores a bracket that is not the whole first argument', () => {
        expect(splitNamespace(['prefix [http]', 'rest']).namespace).toBeNull();
    });

    it('handles an empty arg list', () => {
        expect(splitNamespace([])).toEqual({ namespace: null, rest: [] });
    });
});

describe('createDeviceLogStore', () => {
    it('keeps the structure the text store threw away', () => {
        const s = createDeviceLogStore();
        s.push(entry({ level: 'warn', platform: 'android', client: 3, args: ['[http]', 'slow'] }));
        const [r] = s.records();
        expect(r).toMatchObject({
            level: 'warn',
            platform: 'android',
            client: 3,
            namespace: 'http',
            message: 'slow',
            lineCount: 1,
        });
    });

    it('splits a multi-line message into a head and a line count', () => {
        const s = createDeviceLogStore();
        s.push(entry({ args: ['Error: boom\n  at a.ts:1\n  at b.ts:2'] }));
        const [r] = s.records();
        expect(r!.head).toBe('Error: boom');
        expect(r!.lineCount).toBe(3);
        expect(r!.message).toContain('at b.ts:2');
    });

    it('gives every record a monotonic seq, unaffected by eviction', () => {
        const s = createDeviceLogStore({ limit: 3 });
        for (let i = 0; i < 5; i++) s.push(entry({ args: [`m${i}`] }));
        expect(s.records().map((r) => r.message)).toEqual(['m2', 'm3', 'm4']);
        // seq must not restart — it is the sort tiebreak and the row identity.
        expect(s.records().map((r) => r.seq)).toEqual([2, 3, 4]);
    });

    it('evicts from the front at the limit', () => {
        const s = createDeviceLogStore({ limit: 2 });
        for (let i = 0; i < 10; i++) s.push(entry());
        expect(s.total()).toBe(2);
    });

    it('falls back to `log` for a level it does not know', () => {
        const s = createDeviceLogStore();
        s.push(entry({ level: 'fatal' as DeviceLogEntry['level'] }));
        expect(s.records()[0]!.level).toBe('log');
    });

    it('clears', () => {
        const s = createDeviceLogStore();
        s.push(entry());
        s.clear();
        expect(s.total()).toBe(0);
        expect(s.visible()).toHaveLength(0);
    });
});

describe('filtering', () => {
    function seeded() {
        const s = createDeviceLogStore();
        s.push(entry({ level: 'debug', platform: 'ios', args: ['[http]', 'a'] }));
        s.push(entry({ level: 'warn', platform: 'android', args: ['[nav]', 'b'] }));
        s.push(entry({ level: 'error', platform: 'ios', args: ['boom'] }));
        return s;
    }

    it('filters by minimum level, inclusive', () => {
        const s = seeded();
        s.filter.minLevel = 'warn';
        expect(s.visible().map((r) => r.level)).toEqual(['warn', 'error']);
    });

    it('filters by platform', () => {
        const s = seeded();
        s.filter.platform = 'ios';
        expect(s.visible()).toHaveLength(2);
    });

    it('filters by namespace, with the empty string meaning un-namespaced', () => {
        const s = seeded();
        s.filter.namespace = 'http';
        expect(s.visible().map((r) => r.message)).toEqual(['a']);
        s.filter.namespace = '';
        expect(s.visible().map((r) => r.message)).toEqual(['boom']);
    });

    it('filters by case-insensitive text', () => {
        const s = seeded();
        s.filter.text = 'BOO';
        expect(s.visible().map((r) => r.message)).toEqual(['boom']);
    });

    it('composes filters', () => {
        const s = seeded();
        s.filter.minLevel = 'warn';
        s.filter.platform = 'ios';
        expect(s.visible().map((r) => r.message)).toEqual(['boom']);
    });

    it('reports how many rows the filter is hiding', () => {
        // A filtered view that looks quiet must never be mistaken for a quiet
        // app, so the count has to be available to the status line.
        const s = seeded();
        expect(s.hidden()).toBe(0);
        s.filter.minLevel = 'error';
        expect(s.visible()).toHaveLength(1);
        expect(s.hidden()).toBe(2);
        expect(s.isFiltered()).toBe(true);
    });

    it('re-evaluates after a filter change (the memo must invalidate)', () => {
        const s = seeded();
        expect(s.visible()).toHaveLength(3);
        s.filter.minLevel = 'error';
        expect(s.visible()).toHaveLength(1);
        s.filter.minLevel = null;
        expect(s.visible()).toHaveLength(3);
    });

    it('re-evaluates after a push (the memo must invalidate)', () => {
        const s = seeded();
        s.filter.minLevel = 'error';
        expect(s.visible()).toHaveLength(1);
        s.push(entry({ level: 'error', args: ['second'] }));
        expect(s.visible()).toHaveLength(2);
    });

    it('returns the same array when nothing changed', () => {
        const s = seeded();
        expect(s.visible()).toBe(s.visible());
    });

    it('re-evaluates once the ring is saturated and length stops changing', () => {
        // The memo cannot key on record COUNT alone: at the limit every push
        // evicts one and appends one, so the length is constant while the
        // contents turn over completely. Keying on it would freeze the view
        // exactly when logs are busiest — the case the store exists for.
        const s = createDeviceLogStore({ limit: 2 });
        s.push(entry({ args: ['first'] }));
        s.push(entry({ args: ['second'] }));
        expect(s.visible().map((r) => r.message)).toEqual(['first', 'second']);

        s.push(entry({ args: ['third'] }));
        expect(s.visible().map((r) => r.message)).toEqual(['second', 'third']);

        s.push(entry({ args: ['fourth'] }));
        expect(s.visible().map((r) => r.message)).toEqual(['third', 'fourth']);
    });

    it('re-evaluates after clear()', () => {
        const s = createDeviceLogStore({ limit: 2 });
        s.push(entry());
        expect(s.visible()).toHaveLength(1);
        s.clear();
        expect(s.visible()).toHaveLength(0);
    });

    it('lists only the platforms and namespaces actually seen', () => {
        const s = seeded();
        expect(s.platforms()).toEqual(['android', 'ios']);
        expect(s.namespaces()).toEqual(['http', 'nav']);
    });
});

describe('rankOf', () => {
    it('orders levels by severity', () => {
        const ranks = LEVELS.map(rankOf);
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
        expect(rankOf('error')).toBeGreaterThan(rankOf('warn'));
        expect(rankOf('trace')).toBeLessThan(rankOf('debug'));
    });
});
