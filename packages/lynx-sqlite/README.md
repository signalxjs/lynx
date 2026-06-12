# @sigx/lynx-sqlite

Embedded SQLite database for sigx-lynx — SQL with parameter binding,
transactions, `user_version` migrations and live queries. The persistence
layer for offline-first apps: chat history, message queues, local caches.

Backed by the platform's SQLite (Android `android.database.sqlite`, iOS
system `libsqlite3`) — no bundled C library, nothing added to your binary.

Full docs: <https://sigx.dev/lynx/modules/sqlite/overview/>

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

## Notes & caveats

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
- **Duplicate column names** in joined SELECTs collide (rows are objects)
  — use `AS` aliases.
- Encryption at rest (SQLCipher), FTS5 full-text search guidance and a web
  backend (sqlite-wasm + OPFS) are planned follow-ups.
