/**
 * Migration runner tests against the mocked bridge: pending-only
 * application, the user_version bump inside the same transaction, ordering
 * validation, and failure reporting.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Call {
    method: string;
    args: unknown[];
}

const calls: Call[] = [];
let userVersion = 0;

const bridge = {
    callAsync: vi.fn(async (_module: string, method: string, ...args: unknown[]) => {
        calls.push({ method, args });
        if (method === 'open') return { handle: 1 };
        if (method === 'execute') {
            const sql = String(args[1]);
            if (/^PRAGMA user_version$/i.test(sql.trim())) {
                return { rows: [{ user_version: userVersion }], rowsAffected: 0 };
            }
            const assign = sql.match(/^PRAGMA user_version = (\d+)/i);
            if (assign) userVersion = Number(assign[1]);
            if (/FAIL/.test(sql)) return { error: 'simulated failure' };
            return { rows: [], rowsAffected: 0 };
        }
        return {};
    }),
    isModuleAvailable: vi.fn(() => true),
};

vi.mock('@sigx/lynx-core', () => ({
    callAsync: (...args: unknown[]) =>
        bridge.callAsync(...(args as [string, string, ...unknown[]])),
    isModuleAvailable: () => true,
}));

const { openDatabase } = await import('../src/sqlite.js');

let n = 0;
const uniqueName = () => `migrate-${++n}.db`;

beforeEach(() => {
    calls.length = 0;
    userVersion = 0;
});

const executedSql = () =>
    calls.filter((c) => c.method === 'execute').map((c) => String(c.args[1]));

describe('migrate', () => {
    it('applies pending migrations in order, bumping user_version inside each transaction', async () => {
        const db = await openDatabase(uniqueName());
        calls.length = 0;
        await db.migrate([
            { version: 1, up: ['CREATE TABLE messages (id INTEGER PRIMARY KEY)'] },
            { version: 2, up: ['ALTER TABLE messages ADD COLUMN read INTEGER'] },
        ]);
        expect(calls.map((c) => c.method)).toEqual([
            'execute', // PRAGMA user_version (read)
            'beginTransaction', 'execute', 'execute', 'commit', // v1 + bump
            'beginTransaction', 'execute', 'execute', 'commit', // v2 + bump
        ]);
        expect(executedSql()).toEqual([
            'PRAGMA user_version',
            'CREATE TABLE messages (id INTEGER PRIMARY KEY)',
            'PRAGMA user_version = 1',
            'ALTER TABLE messages ADD COLUMN read INTEGER',
            'PRAGMA user_version = 2',
        ]);
        expect(userVersion).toBe(2);
    });

    it('skips migrations at or below the current version', async () => {
        userVersion = 1;
        const db = await openDatabase(uniqueName());
        calls.length = 0;
        await db.migrate([
            { version: 1, up: ['CREATE TABLE messages (id)'] },
            { version: 2, up: ['ALTER TABLE messages ADD COLUMN read INTEGER'] },
        ]);
        expect(executedSql()).toEqual([
            'PRAGMA user_version',
            'ALTER TABLE messages ADD COLUMN read INTEGER',
            'PRAGMA user_version = 2',
        ]);
    });

    it('supports function migrations', async () => {
        const db = await openDatabase(uniqueName());
        await db.migrate([
            {
                version: 1,
                up: async (tx) => {
                    await tx.execute('CREATE TABLE conversations (id INTEGER PRIMARY KEY)');
                },
            },
        ]);
        expect(executedSql()).toContain('CREATE TABLE conversations (id INTEGER PRIMARY KEY)');
        expect(userVersion).toBe(1);
    });

    it('rejects non-increasing versions without running anything', async () => {
        const db = await openDatabase(uniqueName());
        calls.length = 0;
        await expect(
            db.migrate([
                { version: 2, up: [] },
                { version: 2, up: [] },
            ]),
        ).rejects.toThrow(/strictly increasing/);
        await expect(db.migrate([{ version: 0, up: [] }])).rejects.toThrow(/strictly increasing/);
        expect(calls).toHaveLength(0);
    });

    it('stops on failure, rolls back, and reports the failing version', async () => {
        const db = await openDatabase(uniqueName());
        await expect(
            db.migrate([
                { version: 1, up: ['CREATE TABLE messages (id)'] },
                { version: 2, up: ['FAIL'] },
                { version: 3, up: ['never reached'] },
            ]),
        ).rejects.toThrow(/migration to version 2 failed.*simulated failure/);
        expect(calls.map((c) => c.method)).toContain('rollback');
        expect(executedSql()).not.toContain('never reached');
        expect(userVersion).toBe(1); // v1 committed, v2 rolled back
    });
});
