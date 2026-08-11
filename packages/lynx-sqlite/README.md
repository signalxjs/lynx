# @sigx/lynx-sqlite

Embedded SQLite database for sigx-lynx — SQL with parameter binding,
transactions, `user_version` migrations and live queries. The persistence
layer for offline-first apps: chat history, message queues, local caches.

Backed by the platform's SQLite (Android `android.database.sqlite`, iOS
system `libsqlite3`) — no bundled C library, nothing added to your binary.

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/sqlite/overview/](https://sigx.dev/lynx/modules/sqlite/overview/)**

## Install

```sh
pnpm add @sigx/lynx-sqlite
sigx prebuild   # links the native module
```

## Usage

```ts
import { openDatabase, useLiveQuery } from '@sigx/lynx-sqlite';

// Open once (the same name always returns the same shared instance)
// and declare the schema as migrations.
const db = await openDatabase('chat.db');
await db.migrate([
    {
        version: 1,
        up: [
            `CREATE TABLE messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation TEXT NOT NULL,
                author TEXT NOT NULL,
                body TEXT NOT NULL,
                sent_at INTEGER NOT NULL
            )`,
            `CREATE INDEX idx_messages_conversation
                ON messages(conversation, sent_at)`,
        ],
    },
]);

// Writes
await db.execute(
    'INSERT INTO messages (conversation, author, body, sent_at) VALUES (?, ?, ?, ?)',
    [conversationId, 'me', text, Date.now()],
);

// Reads
const { rows } = await db.execute(
    'SELECT * FROM messages WHERE conversation = ? ORDER BY sent_at DESC LIMIT 50',
    [conversationId],
);
```

In a component, `useLiveQuery` re-runs automatically whenever one of the
query's tables is written through this API — insert a message anywhere and
every list showing it updates:

```tsx
const messages = useLiveQuery(db,
    'SELECT * FROM messages WHERE conversation = ? ORDER BY sent_at DESC LIMIT 50',
    [conversationId]);

return () => (
    <view>
        {messages.value.rows.map((m) => <Bubble message={m} />)}
    </view>
);
```

## API

| Member | Description |
|---|---|
| `openDatabase(name, options?)` | Open/create `name` in the app data dir. Same name → same shared instance. |
| `deleteDatabase(name)` | Delete the file (+ WAL/SHM). The database must be closed. |
| `isAvailable()` | Whether the native module is registered. |
| `db.execute(sql, params?)` | One statement → `{ rows, rowsAffected, insertId }`. Positional `?` binding. |
| `db.executeBatch(statements)` | Many statements, one native call, one transaction — all-or-nothing. |
| `db.transaction(fn)` | Interactive transaction; rolls back if `fn` throws. Other calls queue behind it. |
| `db.migrate(migrations)` | Ordered `PRAGMA user_version` migrations, each atomic. |
| `db.onChange(tables, listener)` | Write notifications (`'*'` = any). Returns unsubscribe. |
| `db.close()` | Release the native handle. |
| `useLiveQuery(db, sql, params?, opts?)` | Reactive query → `Computed<{ rows, loading, error }>`. Accepts the `openDatabase` promise directly. |

### Errors

Everything this package throws is a `SigxError` from `@sigx/lynx-core`, with a
message of the form `[@sigx/lynx-sqlite] <action> failed: <cause>`. Branch on
`code`, never on the message:

| `code` | Raised when |
|---|---|
| `native_error` | The native side reported a failure — a SQL error, a locked file, no disk space. The raw native payload is on `cause`. |
| `invalid_database_name` | `openDatabase` / `deleteDatabase` got something other than a plain file name. |
| `database_open` | `deleteDatabase` while the database is still open. |
| `database_closed` | A call on a database that has been `close()`d. |
| `invalid_sql` | Empty or non-string SQL. |
| `invalid_param` | A param that can't be bound — an object, an `ArrayBuffer`, `NaN`/`Infinity`. |
| `malformed_result` | Native resolved without the handle `openDatabase` needs. |
| `invalid_migration` | Migration versions are not strictly increasing positive integers. |
| `migration_failed` | A migration's statements failed; it was rolled back. The underlying error is on `cause`. |

```ts
import { isSigxError } from '@sigx/lynx-core';

try {
    await db.execute('INSERT INTO messages (body) VALUES (?)', [body]);
} catch (e) {
    if (isSigxError(e) && e.code === 'database_closed') reopen();
}
```

Failures that can't be thrown at a caller — a listener passed to `onChange`
throwing, or a rollback failing while a transaction error is already on its way
out — are logged on the `lynx-sqlite` logger instead, so they reach the
`sigx dev` terminal rather than vanishing.

## Web

**Not supported on web (`sigx run:web`) today.** There is no `.web.ts`
implementation and `@sigx/lynx-web-host` exposes no sqlite handler, so the
native module is never registered: `isAvailable()` returns `false` and
`openDatabase()` rejects with the `Module "Sqlite" is not available` error.

The native handle is confined to `src/sqlite.ts`, so the planned sqlite-wasm
+ OPFS backend can be swapped in behind the same public API. Until it lands,
persist web builds with [`@sigx/lynx-storage`](https://sigx.dev/lynx/modules/storage/overview/),
which ships an IndexedDB web implementation.

## Gotchas

- **Everything is async.** Statements run on a per-database native thread —
  the JS thread is never blocked, so bulk inserts won't jank the UI.
- **BLOBs are not supported (v1).** Store a file path (see
  `@sigx/lynx-file-system`) or base64 TEXT. Binding an object/ArrayBuffer
  throws before reaching native.
- **Big integers**: INTEGER columns come back as JS numbers; above 2^53
  precision is lost. Store snowflake-style ids as TEXT.
- **Live-query scope**: only writes made through this API notify — another
  process or native code touching the same file doesn't. Table extraction
  reads the SQL's FROM/JOIN clauses; for views or exotic SQL pass
  `{ tables: [...] }` explicitly. When extraction is uncertain it
  over-subscribes (`'*'`) rather than miss updates.
- **Don't issue `BEGIN`/`COMMIT` yourself** — use `transaction()` /
  `executeBatch()`, which keep the JS-side operation queue and change
  notifications consistent.
- **Inside `transaction(fn)`, only use `tx.execute`.** Awaiting
  `db.execute(...)` (or a nested `db.transaction`) from within the callback
  deadlocks: the call queues behind the open transaction, which is awaiting
  it. Concurrent `db.execute` calls from *elsewhere* are fine — they simply
  run after the commit.
- **Duplicate column names** in joined SELECTs collide (rows are objects)
  — use `AS` aliases.
- Encryption at rest (SQLCipher), FTS5 full-text search guidance and a web
  backend (sqlite-wasm + OPFS) are planned follow-ups.

## License

MIT
