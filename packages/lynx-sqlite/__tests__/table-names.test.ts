/**
 * Pure unit tests for the SQL table-name extractor that drives live-query
 * invalidation. The contract under test: precise when the SQL is simple,
 * conservative ('*') whenever it isn't.
 */
import { describe, expect, it } from 'vitest';
import { readTables, writtenTables } from '../src/table-names.js';

const set = (...names: string[]) => new Set(names);

describe('writtenTables', () => {
    it('extracts the INSERT target', () => {
        expect(writtenTables('INSERT INTO messages (body) VALUES (?)')).toEqual(set('messages'));
        expect(writtenTables('insert or ignore into Messages values (?)')).toEqual(set('messages'));
        expect(writtenTables('REPLACE INTO "messages" VALUES (?)')).toEqual(set('messages'));
        expect(writtenTables('INSERT INTO main.messages VALUES (?)')).toEqual(set('messages'));
        expect(writtenTables('INSERT INTO [messages] VALUES (?)')).toEqual(set('messages'));
        expect(writtenTables('INSERT INTO `messages` VALUES (?)')).toEqual(set('messages'));
    });

    it('extracts UPDATE and DELETE targets', () => {
        expect(writtenTables('UPDATE messages SET read = 1 WHERE id = ?')).toEqual(set('messages'));
        expect(writtenTables('UPDATE OR REPLACE messages SET read = 1')).toEqual(set('messages'));
        expect(writtenTables('DELETE FROM messages WHERE id = ?')).toEqual(set('messages'));
    });

    it('returns null for read-only statements', () => {
        expect(writtenTables('SELECT * FROM messages')).toBeNull();
        expect(writtenTables('EXPLAIN QUERY PLAN SELECT 1')).toBeNull();
        expect(writtenTables('PRAGMA user_version')).toBeNull();
        expect(writtenTables('PRAGMA user_version = 3')).toBeNull();
        expect(writtenTables('VALUES (1), (2)')).toBeNull();
        expect(writtenTables('WITH recent AS (SELECT 1) SELECT * FROM recent')).toBeNull();
    });

    it('is conservative on write-CTEs and DDL', () => {
        expect(writtenTables('WITH old AS (SELECT id FROM messages) DELETE FROM messages WHERE id IN (SELECT id FROM old)')).toBe('*');
        expect(writtenTables('CREATE TABLE messages (id INTEGER PRIMARY KEY)')).toBe('*');
        expect(writtenTables('DROP TABLE messages')).toBe('*');
        expect(writtenTables('ALTER TABLE messages ADD COLUMN read INTEGER')).toBe('*');
        expect(writtenTables('VACUUM')).toBe('*');
    });

    it('ignores comments and string literals', () => {
        expect(writtenTables('-- delete everything\nSELECT * FROM messages')).toBeNull();
        expect(writtenTables("/* INSERT */ SELECT 'insert into nothing' FROM messages")).toBeNull();
        expect(writtenTables("INSERT INTO messages (body) VALUES ('-- not a comment')")).toEqual(set('messages'));
    });
});

describe('readTables', () => {
    it('extracts FROM and JOIN tables', () => {
        expect(readTables('SELECT * FROM messages')).toEqual(set('messages'));
        expect(readTables('SELECT * FROM messages m JOIN users u ON u.id = m.author')).toEqual(set('messages', 'users'));
        expect(readTables('SELECT * FROM messages LEFT OUTER JOIN users ON 1')).toEqual(set('messages', 'users'));
        expect(readTables('SELECT * FROM main.messages')).toEqual(set('messages'));
        expect(readTables('SELECT * FROM "Messages"')).toEqual(set('messages'));
    });

    it('follows comma-joins with aliases', () => {
        expect(readTables('SELECT * FROM messages, users WHERE users.id = messages.author')).toEqual(set('messages', 'users'));
        expect(readTables('SELECT * FROM messages m, users AS u WHERE u.id = m.author')).toEqual(set('messages', 'users'));
    });

    it('sees through subqueries and CTEs', () => {
        expect(readTables('SELECT * FROM (SELECT * FROM messages) latest')).toEqual(set('messages'));
        const cte = readTables('WITH recent AS (SELECT * FROM messages) SELECT * FROM recent JOIN users ON 1');
        expect(cte).not.toBe('*');
        // The CTE name is a harmless extra subscription — nothing notifies it.
        const names = [...(cte as ReadonlySet<string>)];
        expect(names).toContain('messages');
        expect(names).toContain('users');
    });

    it('returns an empty set for table-less statements', () => {
        expect(readTables('SELECT 1 + 1')).toEqual(set());
        expect(readTables('PRAGMA user_version')).toEqual(set());
    });

    it('does not trip over ORDER BY / IN-list commas', () => {
        expect(readTables('SELECT * FROM messages WHERE id IN (1, 2, 3) ORDER BY sent_at DESC, id')).toEqual(set('messages'));
    });

    it("ignores 'from' inside string literals", () => {
        expect(readTables("SELECT 'from nowhere' FROM messages")).toEqual(set('messages'));
    });
});
