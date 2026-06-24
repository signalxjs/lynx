import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import {
    Button,
    Card,
    Col,
    Heading,
    Input,
    Row,
    ScrollView,
    Text,
} from '@sigx/lynx-daisyui';
import { Haptics } from '@sigx/lynx-haptics';
import { List } from '@sigx/lynx-list';
import {
    isAvailable,
    openDatabase,
    useLiveQuery,
    type SQLiteDatabase,
} from '@sigx/lynx-sqlite';

interface ChatMessage {
    id: number;
    author: string;
    body: string;
    sent_at: number;
}

const DB_NAME = 'showcase-chat.db';

const REPLIES = [
    'Persisted to SQLite — relaunch the app and this thread is still here.',
    'This reply was INSERTed from a timer, and the list updated by itself.',
    'useLiveQuery re-runs whenever the messages table is written.',
    'Try the clear button — DELETE FROM messages empties the live list too.',
];

// Lazy so nothing touches the bridge until the screen is actually opened.
let dbPromise: Promise<SQLiteDatabase> | null = null;
function chatDb(): Promise<SQLiteDatabase> {
    dbPromise ??= openDatabase(DB_NAME).then(async (db) => {
        await db.migrate([
            {
                version: 1,
                up: [
                    `CREATE TABLE messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        author TEXT NOT NULL,
                        body TEXT NOT NULL,
                        sent_at INTEGER NOT NULL
                    )`,
                ],
            },
        ]);
        const seeded = await db.execute<{ n: number }>('SELECT COUNT(*) AS n FROM messages');
        if ((seeded.rows[0]?.n ?? 0) === 0) {
            // Seed a large history so the windowed list has thousands of rows to
            // page over — only a bounded slice is ever rendered as native cells.
            const SEED = 2000;
            const base = Date.now() - SEED * 1000;
            const BATCH = 200;
            for (let start = 0; start < SEED; start += BATCH) {
                const n = Math.min(BATCH, SEED - start);
                const tuples: string[] = [];
                const params: (string | number)[] = [];
                for (let k = 0; k < n; k++) {
                    const i = start + k;
                    tuples.push('(?, ?, ?)');
                    params.push(
                        i % 7 === 0 ? 'bot' : 'me',
                        `Message #${i + 1} — seeded into SQLite.`,
                        base + i * 1000,
                    );
                }
                await db.execute(
                    `INSERT INTO messages (author, body, sent_at) VALUES ${tuples.join(',')}`,
                    params,
                );
            }
        }
        return db;
    });
    return dbPromise;
}

/**
 * SQLite — a WhatsApp-style thread backed by @sigx/lynx-sqlite. Messages
 * are INSERTed into a real database (schema via migrate()); the list is a
 * useLiveQuery that updates on every write — including the simulated reply
 * that arrives from a timer, exactly like a push message would.
 */
export const SqliteChatDemo = component(() => {
    return () =>
        isAvailable() ? (
            <ChatThread />
        ) : (
            <ScrollView class="flex-fill bg-base-100">
                <Screen title="SQLite" />
                <Col gap={16} padding={16}>
                    <Heading level={2}>SQLite</Heading>
                    <Text class="opacity-60">
                        The Sqlite native module isn't available in this runtime.
                    </Text>
                </Col>
            </ScrollView>
        );
});

const ChatThread = component(() => {
    const draft = signal('');
    let replyIndex = 0;

    // Load the whole thread into memory; windowing on the List keeps only a
    // bounded slice rendered as native cells, so thousands of rows stay smooth.
    const messages = useLiveQuery<ChatMessage>(
        chatDb(),
        'SELECT id, author, body, sent_at FROM messages ORDER BY sent_at ASC, id ASC LIMIT 5000',
    );

    const send = async () => {
        const body = draft.value.trim();
        if (!body) return;
        Haptics.selection();
        draft.value = '';
        try {
            const db = await chatDb();
            await db.execute(
                'INSERT INTO messages (author, body, sent_at) VALUES (?, ?, ?)',
                ['me', body, Date.now()],
            );
            // Simulated incoming reply — written outside this component, the
            // live query above picks it up on its own.
            const reply = REPLIES[replyIndex++ % REPLIES.length];
            setTimeout(() => {
                void db.execute(
                    'INSERT INTO messages (author, body, sent_at) VALUES (?, ?, ?)',
                    ['bot', reply, Date.now()],
                );
            }, 700);
        } catch {
            // keep the UI alive; the hook surfaces query errors itself
        }
    };

    const clearAll = async () => {
        Haptics.notification('warning');
        try {
            const db = await chatDb();
            await db.execute('DELETE FROM messages');
        } catch {
            // keep the UI alive
        }
    };

    return () => (
        <Col class="flex-fill bg-base-100">
            <Screen title="SQLite" />
            {/* Recycled chat thread: bottom-anchored, sticks to the newest
                message as the live query inserts rows, and shows a "new
                messages" pill if you've scrolled up. */}
            <List
                items={messages.value.rows}
                keyExtractor={(m) => String(m.id)}
                estimatedItemSize={56}
                inverted
                windowSize={60}
                pageSize={30}
                style={{ flexGrow: 1 }}
                renderItem={(m) => (
                    <view style={{ paddingLeft: '16px', paddingRight: '16px', paddingTop: '4px', paddingBottom: '4px' }}>
                        <Col
                            class={
                                m.author === 'me'
                                    ? 'self-end bg-primary text-primary-content rounded-xl px-3 py-2 max-w-[80%]'
                                    : 'self-start bg-base-200 rounded-xl px-3 py-2 max-w-[80%]'
                            }
                        >
                            <Text>{m.body}</Text>
                        </Col>
                    </view>
                )}
                slots={{
                    header: () => (
                        <Col gap={8} padding={16}>
                            <Heading level={2}>SQLite chat</Heading>
                            <Text class="opacity-60 text-sm">
                                {messages.value.rows.length} messages persisted in
                                `{DB_NAME}`. The whole thread loads into memory, but the
                                recycled `@sigx/lynx-list` (chat mode + windowing) only
                                renders a bounded slice — scroll up to page older.
                            </Text>
                            {messages.value.error ? (
                                <Card bordered>
                                    <Card.Body>
                                        <Text class="text-error">{messages.value.error.message}</Text>
                                    </Card.Body>
                                </Card>
                            ) : null}
                        </Col>
                    ),
                }}
            />
            <Col gap={8} padding={16}>
                <Row gap={8}>
                    <view class="flex-fill">
                        <Input
                            placeholder="Message"
                            variant="bordered"
                            model={() => draft.value}
                        />
                    </view>
                    <Button color="primary" onPress={send}>
                        Send
                    </Button>
                </Row>
                <Button variant="ghost" size="sm" onPress={clearAll}>
                    Clear conversation
                </Button>
            </Col>
        </Col>
    );
});
