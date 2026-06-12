/**
 * Unit tests for the JS-side SQLite API. Mocks `@sigx/lynx-core` so we
 * never hit a real database — the real round-trip is exercised on-device
 * via examples/showcase.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Call {
    method: string;
    args: unknown[];
}

const calls: Call[] = [];
const responders = new Map<string, (args: unknown[]) => unknown>();

const bridge = {
    callAsync: vi.fn(async (module: string, method: string, ...args: unknown[]) => {
        calls.push({ method, args });
        const respond = responders.get(method);
        return respond ? respond(args) : {};
    }),
    isModuleAvailable: vi.fn(() => true),
};

vi.mock('@sigx/lynx-core', () => ({
    callAsync: (...args: unknown[]) =>
        bridge.callAsync(...(args as [string, string, ...unknown[]])),
    isModuleAvailable: (...args: unknown[]) =>
        bridge.isModuleAvailable(...(args as [])),
}));

const { openDatabase, deleteDatabase, isAvailable } = await import('../src/sqlite.js');

// The module keeps a per-name instance registry — unique names per test.
let n = 0;
const uniqueName = () => `test-${++n}.db`;

beforeEach(() => {
    calls.length = 0;
    responders.clear();
    responders.set('open', () => ({ handle: 42 }));
    responders.set('execute', () => ({ rows: [], rowsAffected: 0 }));
    responders.set('executeBatch', () => ({ rowsAffected: 0 }));
    bridge.isModuleAvailable.mockReturnValue(true);
});

describe('openDatabase', () => {
    it('forwards name/options and wires the returned handle into execute', async () => {
        const name = uniqueName();
        const db = await openDatabase(name);
        expect(calls[0]).toEqual({ method: 'open', args: [name, {}] });
        await db.execute('SELECT 1');
        expect(calls[1].method).toBe('execute');
        expect(calls[1].args[0]).toBe(42);
    });

    it('returns the same instance for the same name', async () => {
        const name = uniqueName();
        const a = await openDatabase(name);
        const b = await openDatabase(name);
        expect(a).toBe(b);
        expect(calls.filter((c) => c.method === 'open')).toHaveLength(1);
    });

    it('rejects names that are not plain file names', async () => {
        await expect(openDatabase('../escape.db')).rejects.toThrow(/plain file name/);
        await expect(openDatabase('a/b.db')).rejects.toThrow(/plain file name/);
        await expect(openDatabase('..')).rejects.toThrow(/plain file name/);
        await expect(openDatabase('.')).rejects.toThrow(/plain file name/);
        await expect(deleteDatabase('../escape.db')).rejects.toThrow(/plain file name/);
        await expect(deleteDatabase('..')).rejects.toThrow(/plain file name/);
        expect(calls).toHaveLength(0);
    });

    it('throws on native { error }', async () => {
        responders.set('open', () => ({ error: 'disk full' }));
        await expect(openDatabase(uniqueName())).rejects.toThrow(/disk full/);
    });
});

describe('execute', () => {
    it('normalizes params: boolean → 1/0, undefined → null', async () => {
        const db = await openDatabase(uniqueName());
        await db.execute('INSERT INTO t VALUES (?, ?, ?, ?, ?, ?)', [true, false, undefined, null, 'a', 1.5]);
        const exec = calls.find((c) => c.method === 'execute')!;
        expect(exec.args[2]).toEqual([1, 0, null, null, 'a', 1.5]);
    });

    it('rejects unbindable params before touching the bridge', async () => {
        const db = await openDatabase(uniqueName());
        calls.length = 0;
        await expect(
            db.execute('INSERT INTO t VALUES (?)', [new Date() as unknown as string]),
        ).rejects.toThrow(/BLOBs are not supported/);
        expect(calls).toHaveLength(0);
    });

    it('throws a prefixed error on native { error }', async () => {
        const db = await openDatabase(uniqueName());
        responders.set('execute', () => ({ error: 'no such table: nope' }));
        await expect(db.execute('SELECT * FROM nope')).rejects.toThrow(
            /\[@sigx\/lynx-sqlite\] no such table: nope/,
        );
    });

    it('defaults missing result fields', async () => {
        const db = await openDatabase(uniqueName());
        responders.set('execute', () => ({}));
        expect(await db.execute('CREATE TABLE t (id)')).toEqual({
            rows: [],
            rowsAffected: 0,
            insertId: null,
        });
    });
});

describe('executeBatch', () => {
    it('sends all statements in one native call with normalized params', async () => {
        const db = await openDatabase(uniqueName());
        responders.set('executeBatch', () => ({ rowsAffected: 2 }));
        const result = await db.executeBatch([
            ['INSERT INTO t VALUES (?)', [true]],
            ['INSERT INTO t VALUES (?)', ['x']],
        ]);
        expect(result).toEqual({ rowsAffected: 2 });
        const batch = calls.find((c) => c.method === 'executeBatch')!;
        expect(batch.args[1]).toEqual([
            { sql: 'INSERT INTO t VALUES (?)', params: [1] },
            { sql: 'INSERT INTO t VALUES (?)', params: ['x'] },
        ]);
    });

    it('resolves without a native call for an empty batch', async () => {
        const db = await openDatabase(uniqueName());
        calls.length = 0;
        expect(await db.executeBatch([])).toEqual({ rowsAffected: 0 });
        expect(calls).toHaveLength(0);
    });
});

describe('transaction', () => {
    it('serializes: concurrent execute waits for commit', async () => {
        const db = await openDatabase(uniqueName());
        calls.length = 0;
        const tx = db.transaction(async (t) => {
            await t.execute('INSERT INTO messages (body) VALUES (?)', ['hi']);
        });
        const outside = db.execute('SELECT * FROM messages');
        await Promise.all([tx, outside]);
        expect(calls.map((c) => c.method)).toEqual([
            'beginTransaction',
            'execute', // the tx INSERT
            'commit',
            'execute', // the outside SELECT, strictly after commit
        ]);
    });

    it('rolls back and rethrows when fn throws', async () => {
        const db = await openDatabase(uniqueName());
        calls.length = 0;
        await expect(
            db.transaction(async () => {
                throw new Error('boom');
            }),
        ).rejects.toThrow('boom');
        expect(calls.map((c) => c.method)).toEqual(['beginTransaction', 'rollback']);
    });

    it('returns the fn result', async () => {
        const db = await openDatabase(uniqueName());
        expect(await db.transaction(async () => 'value')).toBe('value');
    });
});

describe('onChange', () => {
    it('notifies subscribers of the written table, not others', async () => {
        const db = await openDatabase(uniqueName());
        const onMessages = vi.fn();
        const onUsers = vi.fn();
        db.onChange(['messages'], onMessages);
        db.onChange(['users'], onUsers);
        await db.execute('INSERT INTO messages (body) VALUES (?)', ['hi']);
        expect(onMessages).toHaveBeenCalledTimes(1);
        expect(onUsers).not.toHaveBeenCalled();
    });

    it("notifies '*' subscribers on any write, and everyone on DDL", async () => {
        const db = await openDatabase(uniqueName());
        const wildcard = vi.fn();
        const onMessages = vi.fn();
        db.onChange('*', wildcard);
        db.onChange(['messages'], onMessages);
        await db.execute('UPDATE users SET name = ?', ['x']);
        expect(wildcard).toHaveBeenCalledTimes(1);
        expect(onMessages).not.toHaveBeenCalled();
        await db.execute('ALTER TABLE users ADD COLUMN age INTEGER');
        expect(wildcard).toHaveBeenCalledTimes(2);
        expect(onMessages).toHaveBeenCalledTimes(1); // DDL is conservative
    });

    it('does not notify on read-only statements', async () => {
        const db = await openDatabase(uniqueName());
        const listener = vi.fn();
        db.onChange('*', listener);
        await db.execute('SELECT * FROM messages');
        expect(listener).not.toHaveBeenCalled();
    });

    it('fires once on commit, never on rollback', async () => {
        const db = await openDatabase(uniqueName());
        const listener = vi.fn();
        db.onChange(['messages'], listener);
        await db.transaction(async (t) => {
            await t.execute('INSERT INTO messages (body) VALUES (?)', ['a']);
            await t.execute('INSERT INTO messages (body) VALUES (?)', ['b']);
        });
        expect(listener).toHaveBeenCalledTimes(1);
        await db
            .transaction(async (t) => {
                await t.execute('INSERT INTO messages (body) VALUES (?)', ['c']);
                throw new Error('abort');
            })
            .catch(() => {});
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('stops notifying after unsubscribe, and survives throwing listeners', async () => {
        const db = await openDatabase(uniqueName());
        const throwing = vi.fn(() => {
            throw new Error('listener bug');
        });
        const healthy = vi.fn();
        const off = db.onChange(['messages'], throwing);
        db.onChange(['messages'], healthy);
        await db.execute('DELETE FROM messages'); // must not reject despite the throw
        expect(healthy).toHaveBeenCalledTimes(1);
        off();
        await db.execute('DELETE FROM messages');
        expect(throwing).toHaveBeenCalledTimes(1);
    });
});

describe('close / deleteDatabase', () => {
    it('close releases the handle and later calls fail fast', async () => {
        const db = await openDatabase(uniqueName());
        await db.close();
        expect(calls.some((c) => c.method === 'close')).toBe(true);
        await expect(db.execute('SELECT 1')).rejects.toThrow(/closed/);
    });

    it('deleteDatabase refuses while the database is open', async () => {
        const name = uniqueName();
        const db = await openDatabase(name);
        await expect(deleteDatabase(name)).rejects.toThrow(/close\(\) it before deleting/);
        await db.close();
        await deleteDatabase(name);
        expect(calls.at(-1)).toEqual({ method: 'deleteDatabase', args: [name] });
    });
});

describe('isAvailable', () => {
    it('delegates to lynx-core', () => {
        bridge.isModuleAvailable.mockReturnValueOnce(false);
        expect(isAvailable()).toBe(false);
        expect(bridge.isModuleAvailable).toHaveBeenCalledWith('Sqlite');
    });
});
