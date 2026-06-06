import { component, onMounted, onUnmounted, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, Heading, Row, ScrollView, Text } from '@sigx/lynx-daisyui';
import { Haptics } from '@sigx/lynx-haptics';
import { Background } from '@sigx/lynx-background';

/**
 * Background tasks — BGTaskScheduler (iOS) / WorkManager (Android) via
 * @sigx/lynx-background. The handler is wired BEFORE listing/registering —
 * the OS can fire the task as soon as the process starts, so handlers must
 * be attached at cold-start time. (In a real app you'd attach it in app
 * bootstrap, not a screen; the showcase accepts the screen-mount tradeoff.)
 */
export const BackgroundTasks = component(() => {
    const bgRegistered = signal<string[]>([]);
    const bgLastFire = signal<string | null>(null);
    const bgFeedTitle = signal<string | null>(null);
    let bgUnsubHandler: (() => void) | null = null;

    onMounted(async () => {
        bgUnsubHandler = Background.setHandler('refresh-feed', async () => {
            bgLastFire.value = new Date().toISOString();
            try {
                const res = await fetch('https://jsonplaceholder.typicode.com/posts/1');
                const json = (await res.json()) as { title?: string };
                bgFeedTitle.value = json.title ?? '(no title)';
            } catch (err) {
                bgFeedTitle.value = `error: ${String(err)}`;
            }
        });
        if (Background.isAvailable()) {
            bgRegistered.$set(await Background.getRegistered());
        }
    });
    onUnmounted(() => {
        bgUnsubHandler?.();
    });

    const onBgRegister = async () => {
        Haptics.selection();
        await Background.register('refresh-feed', {
            minimumInterval: 15 * 60,
            requiresNetwork: true,
        });
        bgRegistered.$set(await Background.getRegistered());
    };
    const onBgUnregister = async () => {
        Haptics.selection();
        await Background.unregister('refresh-feed');
        bgRegistered.$set(await Background.getRegistered());
    };

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Background tasks" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Background tasks</Heading>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">BGTaskScheduler / WorkManager</Text>
                            <Text class="opacity-60 text-sm">
                                Registers a periodic `refresh-feed` task. The OS
                                decides when to fire (iOS: opportunistic, often
                                hours; Android: ≥15 min). The handler runs in
                                the background, fetches a JSON feed, and the
                                result shows on next foreground. Real testing
                                needs the iOS scheduler debugger or `adb shell
                                cmd jobscheduler run` — see the package README.
                            </Text>
                            <Row gap={8} align="center">
                                <Button variant="primary" onPress={onBgRegister}>
                                    Register refresh-feed
                                </Button>
                                <Button variant="ghost" onPress={onBgUnregister}>
                                    Unregister
                                </Button>
                            </Row>
                            <Text class="font-mono text-sm opacity-70">
                                available: {String(Background.isAvailable())}{'\n'}
                                registered: {bgRegistered.length ? bgRegistered.join(', ') : '—'}{'\n'}
                                last fire: {bgLastFire.value ?? '—'}{'\n'}
                                last title: {bgFeedTitle.value ?? '—'}
                            </Text>
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
