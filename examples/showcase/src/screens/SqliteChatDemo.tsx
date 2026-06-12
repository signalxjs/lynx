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
            await db.execute(
                'INSERT INTO messages (author, body, sent_at) VALUES (?, ?, ?)',
                ['bot', 'Welcome! Every message here lives in a local SQLite database.', Date.now()],
            );
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

    const messages = useLiveQuery<ChatMessage>(
        chatDb(),
        'SELECT id, author, body, sent_at FROM messages ORDER BY sent_at ASC, id ASC LIMIT 200',
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
            <ScrollView class="flex-fill">
                <Col gap={8} padding={16}>
                    <Heading level={2}>SQLite chat</Heading>
                    <Text class="opacity-60 text-sm">
                        Messages persist in `{DB_NAME}` and survive an app
                        relaunch. The thread is a live query over the messages
                        table.
                    </Text>
                    {messages.value.error ? (
                        <Card bordered>
                            <Card.Body>
                                <Text class="text-error">{messages.value.error.message}</Text>
                            </Card.Body>
                        </Card>
                    ) : null}
                    {messages.value.rows.map((m) => (
                        <Col
                            class={
                                m.author === 'me'
                                    ? 'self-end bg-primary text-primary-content rounded-xl px-3 py-2 max-w-[80%]'
                                    : 'self-start bg-base-200 rounded-xl px-3 py-2 max-w-[80%]'
                            }
                        >
                            <Text>{m.body}</Text>
                        </Col>
                    ))}
                </Col>
            </ScrollView>
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
