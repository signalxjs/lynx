import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Col, Input, Row, Text } from '@sigx/lynx-daisyui';
import { Haptics } from '@sigx/lynx-haptics';
import { List } from '@sigx/lynx-list';

interface Msg {
    id: number;
    author: 'me' | 'bot';
    body: string;
}

const SAMPLE = [
    'Hey! How did the list rollout go?',
    'Shipped — feed, grid, pull-to-refresh, chat mode, windowing.',
    'Nice. Does it scroll smoothly with a long history?',
    'Yep — only a bounded window is mounted no matter how far up you scroll, so a thread with thousands of messages stays just as smooth as a short one and memory stays flat.',
    'And it sticks to the bottom on new messages?',
    'When you are at the bottom it auto-follows; if you have scrolled up to read history it leaves you there and shows a “new messages” pill so you never lose your place.',
    'Love it. 🎉',
    'Here is a deliberately long one to make sure variable-height bubbles lay out correctly: chat messages have no fixed size, so a wall of text like this that wraps across four or five lines must render fully — no clipping at the bottom edge, even right as it arrives and the list scrolls down to it.',
    'Short.',
    'Another multi-line message so consecutive tall bubbles get exercised back-to-back as they arrive and the list animates to the bottom.',
];

// Seed a back-history so "load older" (scroll up) has something to page in.
const HISTORY: Msg[] = Array.from({ length: 120 }, (_, i) => ({
    id: i,
    author: i % 2 === 0 ? 'bot' : 'me',
    body: `${SAMPLE[i % SAMPLE.length]} (#${i})`,
}));

const INITIAL = 25;
const PAGE = 25;

/**
 * Chat (`@sigx/lynx-list` chat mode) — a bottom-anchored recycled message
 * thread, in memory (no SQLite). Demonstrates, on their own:
 *
 *  • `inverted` — first paint is already at the newest message.
 *  • `stickToBottom` — Send appends and auto-scrolls when you're at the bottom.
 *  • the **unread affordance** — "Receive" appends a bot message; if you've
 *    scrolled up it surfaces the `newMessages` pill (tap to jump down + clear).
 *  • **load-older** — `onStartReached` pages earlier history in as you scroll up.
 */
export const ChatDemo = component(() => {
    const draft = signal('');
    const loadingOlder = signal(false);
    const messages = signal<{ value: Msg[] }>({
        value: HISTORY.slice(HISTORY.length - INITIAL),
    });
    let oldestLoaded = HISTORY.length - INITIAL;
    let nextId = HISTORY.length;
    let replyIndex = 0;

    const append = (m: Msg): void => { messages.value = [...messages.value, m]; };

    const send = (): void => {
        const body = draft.value.trim();
        if (!body) return;
        Haptics.selection();
        draft.value = '';
        append({ id: nextId++, author: 'me', body });
        // Simulated reply a beat later — sticks to bottom if you stayed there.
        setTimeout(() => {
            append({ id: nextId++, author: 'bot', body: SAMPLE[replyIndex++ % SAMPLE.length] });
        }, 700);
    };

    // Append a bot message without any scroll — scroll up first to watch the
    // unread pill appear.
    const receive = (): void => {
        append({ id: nextId++, author: 'bot', body: SAMPLE[replyIndex++ % SAMPLE.length] });
    };

    // Page older history in when the user scrolls to the top. This is the real
    // backend pattern: onStartReached → await fetch(beforeCursor) → prepend. The
    // in-flight guard de-dups the edge event; the artificial latency stands in
    // for a network round-trip.
    const loadOlder = async (): Promise<void> => {
        if (loadingOlder.value || oldestLoaded <= 0) return;
        loadingOlder.value = true;
        await new Promise<void>((resolve) => setTimeout(resolve, 600));
        const start = Math.max(0, oldestLoaded - PAGE);
        messages.value = [...HISTORY.slice(start, oldestLoaded), ...messages.value];
        oldestLoaded = start;
        loadingOlder.value = false;
    };


    return () => (
        <Col class="flex-fill bg-base-100">
            <Screen title="Chat" />
            <List
                items={messages.value}
                keyExtractor={(m) => String(m.id)}
                inverted
                stickToBottom
                onStartReached={() => { void loadOlder(); }}
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
                        <Col gap={4} padding={16} class="items-center">
                            {loadingOlder.value ? (
                                <Text class="opacity-60 text-sm">Loading earlier messages…</Text>
                            ) : oldestLoaded > 0 ? (
                                <Text class="opacity-60 text-sm">Scroll up to load older history</Text>
                            ) : (
                                <Text class="opacity-40 text-sm">· beginning of conversation ·</Text>
                            )}
                        </Col>
                    ),
                    newMessages: ({ count }: { count: number }) => (
                        <view class="bg-primary text-primary-content rounded-full px-4 py-2 shadow">
                            <Text class="text-primary-content text-sm">{count} new ↓</Text>
                        </view>
                    ),
                }}
            />
            <Row gap={8} padding={16} class="items-center">
                <view class="flex-fill">
                    <Input placeholder="Message" variant="bordered" model={() => draft.value} />
                </view>
                <Button variant="outline" onPress={receive}>Receive</Button>
                <Button color="primary" onPress={send}>Send</Button>
            </Row>
        </Col>
    );
});
