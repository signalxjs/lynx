import { component, onMounted, onUnmounted, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, Heading, Row, ScrollView, Text } from '@sigx/lynx-daisyui';
import { Haptics } from '@sigx/lynx-haptics';
import { Notifications, type NotificationResponse, type RemoteMessage } from '@sigx/lynx-notifications';

/**
 * Notifications — push (APNs / FCM) registration plus local scheduling via
 * @sigx/lynx-notifications. Listeners are wired before registering: token
 * replay handles the ordering edge case, but wiring first is the cleaner
 * pattern.
 */
export const NotificationsDemo = component(() => {
    const permStatus = signal<string>('unknown');
    const pushToken = signal<string | null>(null);
    const pushPlatform = signal<string | null>(null);
    const pushError = signal<string | null>(null);
    // Boxed in an outer object so the union `T | null` satisfies signal's
    // `T extends object` overload.
    const lastMessage = signal<{ value: RemoteMessage | null }>({ value: null });
    const lastTap = signal<{ value: NotificationResponse | null }>({ value: null });
    const initialTap = signal<{ value: NotificationResponse | null }>({ value: null });
    let unsubToken: (() => void) | null = null;
    let unsubTokenErr: (() => void) | null = null;
    let unsubMsg: (() => void) | null = null;
    let unsubTap: (() => void) | null = null;

    onMounted(async () => {
        unsubToken = Notifications.addTokenListener(({ token, platform }) => {
            pushToken.value = token;
            pushPlatform.value = platform;
            pushError.value = null;
        });
        unsubTokenErr = Notifications.addTokenErrorListener(({ error }) => {
            pushError.value = error;
        });
        unsubMsg = Notifications.addPushListener((msg) => { lastMessage.value = msg; });
        unsubTap = Notifications.addNotificationResponseListener((resp) => { lastTap.value = resp; });

        const status = await Notifications.getPermissionStatus();
        permStatus.value = status.status;
        const initial = await Notifications.getInitialNotification();
        if (initial) initialTap.value = initial;
    });
    onUnmounted(() => {
        unsubToken?.(); unsubTokenErr?.(); unsubMsg?.(); unsubTap?.();
    });

    const onRequestPerm = async () => {
        Haptics.selection();
        const res = await Notifications.requestPermission();
        permStatus.value = res.status;
    };
    const onRegister = async () => {
        Haptics.selection();
        const res = await Notifications.registerForPushNotifications();
        // iOS: real token arrives via listener. Android: token is here.
        if (res.token) {
            pushToken.value = res.token;
            pushPlatform.value = res.platform ?? null;
        }
        if (res.error) pushError.value = res.error;
    };
    const onScheduleLocal = async () => {
        Haptics.notification('success');
        await Notifications.schedule(
            { title: 'Test notification', body: 'Tap me to see the response payload', data: { source: 'showcase' } },
            { delay: 5 },
        );
    };
    const onClearBadge = async () => {
        Haptics.selection();
        await Notifications.setBadgeCount(0);
    };

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Notifications" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Notifications</Heading>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Push notifications (APNs / FCM)</Text>
                            <Text class="opacity-60 text-sm">
                                Permission: {permStatus.value}.
                                Subscribe to token / message / tap events, then
                                register. iOS needs a real device + APNs
                                entitlement; Android needs `google-services.json`
                                — see the package README.
                            </Text>
                            <Row gap={8} align="center">
                                <Button variant="primary" outline onPress={onRequestPerm}>
                                    Request permission
                                </Button>
                                <Button variant="primary" onPress={onRegister}>
                                    Register for push
                                </Button>
                            </Row>
                            <Row gap={8} align="center">
                                <Button variant="secondary" outline onPress={onScheduleLocal}>
                                    Schedule local (5s)
                                </Button>
                                <Button variant="ghost" onPress={onClearBadge}>
                                    Clear badge
                                </Button>
                            </Row>
                            <Text class="font-mono text-sm opacity-70">
                                token: {pushToken.value ? `${pushPlatform.value}:${pushToken.value.slice(0, 24)}…` : '—'}{'\n'}
                                error: {pushError.value ?? '—'}{'\n'}
                                last push: {lastMessage.value ? (lastMessage.value.title ?? '(no title)') : '—'}{'\n'}
                                last tap: {lastTap.value ? lastTap.value.notificationId.slice(0, 16) : '—'}{'\n'}
                                cold-start tap: {initialTap.value ? initialTap.value.notificationId.slice(0, 16) : '—'}
                            </Text>
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
