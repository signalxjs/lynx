/**
 * useLiveQuery tests: mocked bridge (an in-memory `messages` array stands
 * in for the table) and mocked `@sigx/lynx` reactivity primitives.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── @sigx/lynx mock: plain signal/computed, manual unmount trigger ────────
vi.mock('@sigx/lynx', () => {
    const unmountCallbacks: Array<() => void> = [];
    return {
        // Object signals are proxies: property reads see the current value,
        // $set replaces it wholesale (matches @sigx/reactivity's contract).
        signal: <T extends object>(initial: T) => {
            let current = initial;
            return new Proxy({} as T & { $set: (next: T) => void }, {
                get(_, prop) {
                    if (prop === '$set') return (next: T) => { current = next; };
                    return (current as Record<string | symbol, unknown>)[prop];
                },
            });
        },
        computed: <T,>(fn: () => T) => ({
            get value() { return fn(); },
        }),
        onUnmounted: (cb: () => void) => {
            unmountCallbacks.push(cb);
        },
        __runUnmount: () => {
            unmountCallbacks.splice(0).forEach((cb) => cb());
        },
    };
});

// ── @sigx/lynx-core mock: a tiny "messages table" behind the bridge ──────
let messages: Array<{ id: number; body: string }> = [];
let failSelects = false;

const bridge = {
    callAsync: vi.fn(async (_module: string, method: string, ...args: unknown[]) => {
        if (method === 'open') return { handle: 1 };
        if (method === 'execute') {
            const sql = String(args[1]);
            if (/^SELECT/i.test(sql.trim())) {
                if (failSelects) return { error: 'simulated failure' };
                return { rows: [...messages], rowsAffected: 0 };
            }
            if (/^INSERT INTO messages/i.test(sql.trim())) {
                const params = args[2] as [string];
                messages.push({ id: messages.length + 1, body: params[0] });
                return { rows: [], rowsAffected: 1, insertId: messages.length };
            }
            return { rows: [], rowsAffected: 1 };
        }
        return {};
    }),
    isModuleAvailable: () => true,
};

vi.mock('@sigx/lynx-core', () => ({
    callAsync: (...args: unknown[]) =>
        bridge.callAsync(...(args as [string, string, ...unknown[]])),
    isModuleAvailable: () => true,
}));

const lynx = (await import('@sigx/lynx')) as unknown as { __runUnmount: () => void };
const { openDatabase } = await import('../src/sqlite.js');
const { useLiveQuery } = await import('../src/use-live-query.js');

let n = 0;
const uniqueName = () => `live-${++n}.db`;

beforeEach(() => {
    messages = [];
    failSelects = false;
    lynx.__runUnmount();
    bridge.callAsync.mockClear();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('useLiveQuery', () => {
    it('loads the initial rows and clears loading', async () => {
        messages.push({ id: 1, body: 'hello' });
        const db = openDatabase(uniqueName()); // promise accepted directly
        const q = useLiveQuery(db, 'SELECT * FROM messages');
        expect(q.value.loading).toBe(true);
        await vi.waitFor(() => expect(q.value.loading).toBe(false));
        expect(q.value.rows).toEqual([{ id: 1, body: 'hello' }]);
        expect(q.value.error).toBeNull();
    });

    it('re-runs when a subscribed table is written', async () => {
        const db = await openDatabase(uniqueName());
        const q = useLiveQuery(db, 'SELECT * FROM messages');
        await vi.waitFor(() => expect(q.value.loading).toBe(false));
        expect(q.value.rows).toEqual([]);
        await db.execute('INSERT INTO messages (body) VALUES (?)', ['new message']);
        await vi.waitFor(() => expect(q.value.rows).toHaveLength(1));
        expect(q.value.rows[0]).toEqual({ id: 1, body: 'new message' });
    });

    it('does not re-run on writes to unrelated tables', async () => {
        const db = await openDatabase(uniqueName());
        const q = useLiveQuery(db, 'SELECT * FROM messages');
        await vi.waitFor(() => expect(q.value.loading).toBe(false));
        // callAsync args: (module, method, handle, sql, params) — sql is [3].
        const countSelects = () =>
            bridge.callAsync.mock.calls.filter(
                (c) => c[1] === 'execute' && /^SELECT/i.test(String(c[3])),
            ).length;
        const selectsBefore = countSelects();
        await db.execute('UPDATE users SET name = ?', ['x']);
        await flush();
        const selectsAfter = countSelects();
        expect(selectsAfter).toBe(selectsBefore);
    });

    it('honors an explicit tables option', async () => {
        const db = await openDatabase(uniqueName());
        const q = useLiveQuery(db, 'SELECT * FROM messages', [], { tables: ['users'] });
        await vi.waitFor(() => expect(q.value.loading).toBe(false));
        messages.push({ id: 1, body: 'visible after users write' });
        await db.execute('UPDATE users SET name = ?', ['x']);
        await vi.waitFor(() => expect(q.value.rows).toHaveLength(1));
    });

    it('keeps previous rows and sets error on query failure', async () => {
        const db = await openDatabase(uniqueName());
        messages.push({ id: 1, body: 'kept' });
        const q = useLiveQuery(db, 'SELECT * FROM messages');
        await vi.waitFor(() => expect(q.value.rows).toHaveLength(1));
        failSelects = true; // the INSERT succeeds, the triggered re-run fails
        await db.execute('INSERT INTO messages (body) VALUES (?)', ['trigger']);
        await vi.waitFor(() => expect(q.value.error).not.toBeNull());
        expect(q.value.rows).toEqual([{ id: 1, body: 'kept' }]); // previous rows kept
    });

    it('converges on the latest data after rapid consecutive writes', async () => {
        const db = await openDatabase(uniqueName());
        const q = useLiveQuery(db, 'SELECT * FROM messages');
        await vi.waitFor(() => expect(q.value.loading).toBe(false));
        await Promise.all([
            db.execute('INSERT INTO messages (body) VALUES (?)', ['one']),
            db.execute('INSERT INTO messages (body) VALUES (?)', ['two']),
            db.execute('INSERT INTO messages (body) VALUES (?)', ['three']),
        ]);
        await vi.waitFor(() => expect(q.value.rows).toHaveLength(3));
    });

    it('stops re-running after unmount', async () => {
        const db = await openDatabase(uniqueName());
        const q = useLiveQuery(db, 'SELECT * FROM messages');
        await vi.waitFor(() => expect(q.value.loading).toBe(false));
        lynx.__runUnmount();
        await db.execute('INSERT INTO messages (body) VALUES (?)', ['after unmount']);
        await flush();
        expect(q.value.rows).toEqual([]); // never saw the post-unmount write
    });

    it('surfaces an open failure as error', async () => {
        const failing = Promise.reject(new Error('module unavailable'));
        const q = useLiveQuery(failing, 'SELECT * FROM messages');
        await vi.waitFor(() => expect(q.value.error).not.toBeNull());
        expect(q.value.loading).toBe(false);
        expect(q.value.error?.message).toMatch(/module unavailable/);
    });
});
