import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { ScrollView, Swipeable } from '@sigx/lynx-gestures';
import { Haptics } from '@sigx/lynx-haptics';
import { Col, Heading, Row, Text } from '@sigx/lynx-daisyui';

interface Mail {
    id: number;
    from: string;
    subject: string;
    preview: string;
    flagged: boolean;
}

const INITIAL: Mail[] = [
    { id: 1, from: 'Ada Lovelace', subject: 'Analytical engine notes', preview: 'The engine weaves algebraic patterns…', flagged: false },
    { id: 2, from: 'Grace Hopper', subject: 'Compiler progress', preview: 'It is easier to ask forgiveness than…', flagged: true },
    { id: 3, from: 'Alan Turing', subject: 'On computable numbers', preview: 'We may compare a man in the process…', flagged: false },
    { id: 4, from: 'Katherine Johnson', subject: 'Trajectory review', preview: 'The orbital insertion window holds at…', flagged: false },
    { id: 5, from: 'Margaret Hamilton', subject: 'Priority displays', preview: 'The software caught the overload and…', flagged: false },
    { id: 6, from: 'Barbara Liskov', subject: 'Substitution sketch', preview: 'If S is a subtype of T, then objects…', flagged: false },
    { id: 7, from: 'Edsger Dijkstra', subject: 'Goto considered…', preview: 'The quality of programmers is a…', flagged: false },
    { id: 8, from: 'Donald Knuth', subject: 'Premature optimization', preview: 'We should forget about small…', flagged: false },
];

const ACTION_W = 76;

/**
 * Email-style swipeable list — `<Swipeable>` rows with render-prop action
 * panels inside the gestures `<ScrollView>`. Vertical scroll and horizontal
 * swipe never fight: the rows flip the scroll context's `dragging` signal
 * automatically, so the scroller yields for the duration of the swipe.
 */
export const SwipeActionsDemo = component(() => {
    const mails = signal<Mail[]>(INITIAL);
    const archived = signal(0);

    const archive = (id: number): void => {
        mails.$set(mails.filter((m) => m.id !== id));
        archived.value += 1;
        Haptics.notification('success');
    };
    const remove = (id: number): void => {
        mails.$set(mails.filter((m) => m.id !== id));
        Haptics.impact('medium');
    };
    const toggleFlag = (id: number): void => {
        mails.$set(mails.map((m) => (m.id === id ? { ...m, flagged: !m.flagged } : m)));
        Haptics.selection();
    };

    const actionPanel = (label: string, cls: string, onTap: () => void) => (
        <view
            class={cls}
            style={{ flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center' }}
            bindtap={onTap}
        >
            <text style={{ color: 'white', fontSize: '13px' }}>{label}</text>
        </view>
    );

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Swipe Actions" />
            <Col gap={12} padding={16}>
                <Heading level={2}>Swipeable list</Heading>
                <Text class="opacity-60 text-sm">
                    Swipe right for archive, left for flag &amp; delete. The foreground
                    is dragged on the main thread and snaps with native physics.
                </Text>
                <Row justify="space-between">
                    <Text class="text-xs opacity-60">{mails.length} messages</Text>
                    <Text class="text-xs opacity-60">archived: {archived.value}</Text>
                </Row>

                <Col gap={8}>
                    {mails.map((mail) => (
                        <Swipeable
                            key={mail.id}
                            leftActionsWidth={ACTION_W}
                            rightActionsWidth={ACTION_W * 2}
                            leftActions={() => actionPanel('Archive', 'bg-success', () => archive(mail.id))}
                            rightActions={() => (
                                <Row width="100%" height="100%">
                                    {actionPanel(mail.flagged ? 'Unflag' : 'Flag', 'bg-warning', () => toggleFlag(mail.id))}
                                    {actionPanel('Delete', 'bg-error', () => remove(mail.id))}
                                </Row>
                            )}
                            onSwipeOpen={() => Haptics.selection()}
                            style={{ borderRadius: '12px' }}
                        >
                            <view class="bg-base-200" style={{ padding: '12px', borderRadius: '12px' }}>
                                <Row justify="space-between" align="center">
                                    <Text weight="semibold" class="text-sm">{mail.from}</Text>
                                    {mail.flagged ? <text style={{ fontSize: '12px' }}>🚩</text> : null}
                                </Row>
                                <Text class="text-sm">{mail.subject}</Text>
                                <Text class="text-xs opacity-50">{mail.preview}</Text>
                            </view>
                        </Swipeable>
                    ))}
                </Col>

                {mails.length === 0 ? (
                    <Col align="center" padding={24} gap={8}>
                        <text style={{ fontSize: '32px' }}>📭</text>
                        <Text class="opacity-60 text-sm">Inbox zero!</Text>
                    </Col>
                ) : null}
            </Col>
        </ScrollView>
    );
});
