import { component, onMounted, onUnmounted, signal, useElementLayout } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import {
    Button,
    Card,
    Col,
    Heading,
    listThemes,
    Modal,
    Row,
    ScrollView,
    Text,
    Toggle,
    useTheme,
    type DaisyTheme,
} from '@sigx/lynx-daisyui';
import {
    setStatusBarStyle,
    setSystemBarsStyle,
    useSystemColorScheme,
} from '@sigx/lynx-appearance';
import { Haptics } from '@sigx/lynx-haptics';
import { FaBrandIcon, FaSolidIcon } from '@sigx/lynx-icons-fa-free/components';
import { LucideIcon } from '@sigx/lynx-icons-lucide/components';
import { Notifications, type NotificationResponse, type RemoteMessage } from '@sigx/lynx-notifications';
import { clearAllTrips, trips } from '../store/trips.js';

export const Settings = component(() => {
    const theme = useTheme();
    const systemScheme = useSystemColorScheme();
    const confirmOpen = signal(false);
    const { layout: cardLayout, onLayoutChange } = useElementLayout();

    // ── Notifications demo state ────────────────────────────────────────────
    const permStatus = signal<string>('unknown');
    const pushToken = signal<string | null>(null);
    const pushPlatform = signal<string | null>(null);
    const pushError = signal<string | null>(null);
    // Boxed in an outer object so the union `T | null` satisfies signal's
    // `T extends object` overload — same pattern as NewEntry's `coords`.
    const lastMessage = signal<{ value: RemoteMessage | null }>({ value: null });
    const lastTap = signal<{ value: NotificationResponse | null }>({ value: null });
    const initialTap = signal<{ value: NotificationResponse | null }>({ value: null });
    let unsubToken: (() => void) | null = null;
    let unsubTokenErr: (() => void) | null = null;
    let unsubMsg: (() => void) | null = null;
    let unsubTap: (() => void) | null = null;

    onMounted(async () => {
        // Wire listeners BEFORE registering — token replay handles the
        // ordering edge case, but this is the cleaner pattern.
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

    const onClear = () => {
        Haptics.notification('warning');
        clearAllTrips();
        confirmOpen.value = false;
    };

    const pickTheme = (name: DaisyTheme) => {
        Haptics.selection();
        theme.set(name);
    };

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen headerShown={false} />
            <Col gap={16} padding={16}>
                <Heading level={2}>Settings</Heading>

                <Card bordered>
                    <Card.Body>
                        <Col gap={12}>
                            <Col gap={2}>
                                <Text weight="semibold">Theme</Text>
                                <Text class="opacity-60 text-sm">
                                    System: {systemScheme.value} ·{' '}
                                    {theme.followingSystem
                                        ? 'following system'
                                        : `pinned to ${theme.name}`}
                                </Text>
                            </Col>
                            <Row gap={8} wrap>
                                {listThemes().map((meta) => (
                                    <Button
                                        key={meta.name}
                                        size="sm"
                                        variant={theme.name === meta.name ? 'primary' : 'ghost'}
                                        outline={theme.name !== meta.name}
                                        onPress={() => pickTheme(meta.name)}
                                    >
                                        {meta.name.replace('daisy-', '')} ({meta.variant[0]})
                                    </Button>
                                ))}
                            </Row>
                            <Row gap={8}>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    outline
                                    onPress={() => {
                                        Haptics.selection();
                                        theme.toggle();
                                    }}
                                >
                                    Toggle (pair)
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    outline
                                    onPress={() => {
                                        Haptics.selection();
                                        theme.followSystem();
                                    }}
                                >
                                    Follow system
                                </Button>
                            </Row>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Quick dark toggle</Text>
                            <Text class="opacity-60 text-sm">
                                Flips between the active variant's pair via
                                theme.toggle(). Pins the theme — tap "Follow
                                system" above to resume auto-detection.
                            </Text>
                            <Row align="center" justify="space-between">
                                <Text>Dark variant active</Text>
                                <Toggle
                                    checked={theme.name.includes('dark')
                                        || theme.name.includes('synthwave')
                                        || theme.name.includes('dracula')}
                                    onChange={() => {
                                        Haptics.selection();
                                        theme.toggle();
                                    }}
                                />
                            </Row>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">System bars (raw API)</Text>
                            <Text class="opacity-60 text-sm">
                                Bypasses StatusBarSync to call
                                @sigx/lynx-appearance directly — use this to
                                verify the native bridge independent of theme
                                logic.
                            </Text>
                            <Row gap={8} wrap>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    outline
                                    onPress={() => { void setStatusBarStyle('light'); }}
                                >
                                    Status: light
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    outline
                                    onPress={() => { void setStatusBarStyle('dark'); }}
                                >
                                    Status: dark
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    outline
                                    onPress={() => {
                                        void setSystemBarsStyle({
                                            statusBar: 'dark',
                                            navigationBar: { style: 'dark', color: '#ffffff' },
                                        });
                                    }}
                                >
                                    All bars: dark + white bg
                                </Button>
                            </Row>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Lynx 3.7 — selectable text</Text>
                            <Text class="opacity-60 text-sm">
                                Long-press the paragraph below to select text and
                                copy via the system menu. Powered by daisyui's new
                                `selectable` prop on `Text`, which maps to Lynx's
                                `text-selection` attribute.
                            </Text>
                            <Text selectable>
                                Long-press anywhere in this sentence. The system
                                selection handles should appear and the platform
                                Copy / Share menu should open on iOS and Android.
                            </Text>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Lynx 3.7 — useElementLayout</Text>
                            <Text class="opacity-60 text-sm">
                                The view below reports its own measured size and
                                page position via the new `bindlayoutchange`
                                event, surfaced as a signal by `useElementLayout`.
                            </Text>
                            <view
                                class="bg-base-200 rounded-lg p-4"
                                bindlayoutchange={onLayoutChange}
                            >
                                <Text class="font-mono text-sm">
                                    width: {cardLayout.value?.width ?? '—'}{'\n'}
                                    height: {cardLayout.value?.height ?? '—'}{'\n'}
                                    top: {cardLayout.value?.top ?? '—'}{'\n'}
                                    left: {cardLayout.value?.left ?? '—'}
                                </Text>
                            </view>
                        </Col>
                    </Card.Body>
                </Card>

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

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Clear all data</Text>
                            <Text class="opacity-60 text-sm">
                                Wipes every trip and entry from persistent
                                storage. {trips.length} trip{trips.length === 1 ? '' : 's'} currently saved.
                            </Text>
                            <Button
                                variant="error"
                                outline
                                onPress={() => { confirmOpen.value = true; }}
                            >
                                Clear all data
                            </Button>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">@sigx/lynx-icons</Text>
                            <Text class="opacity-60 text-sm">
                                Pinned per-set components from each adapter
                                (`FaSolidIcon`, `FaBrandIcon`, `LucideIcon`)
                                themed via daisy variants — the color
                                resolver provided by `ThemeProvider` maps
                                `variant` to the active theme's hex.
                            </Text>
                            <Row gap={16} align="center">
                                <FaSolidIcon name="user" size={24} variant="primary" />
                                <FaSolidIcon name="house" size={24} variant="secondary" />
                                <FaSolidIcon name="gear" size={24} variant="accent" />
                                <FaBrandIcon name="github" size={24} variant="neutral" />
                                <LucideIcon name="search" size={24} variant="info" />
                                <LucideIcon name="bell" size={24} variant="warning" />
                            </Row>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Dynamic icon names</Text>
                            <Text class="opacity-60 text-sm">
                                Names come from a JS array — the JSX scanner can't
                                see them. With `include: ['*']` on the `fas` set in
                                signalx.config.ts, the full FA solid catalog is
                                bundled and these resolve at runtime.
                            </Text>
                            <Row gap={16} align="center">
                                {['rocket', 'bug', 'fire', 'star', 'heart'].map((name) => (
                                    <FaSolidIcon name={name} size={24} variant="primary" />
                                ))}
                            </Row>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Row align="center" justify="space-between">
                            <Text class="opacity-60">Version</Text>
                            <Text>0.1.0</Text>
                        </Row>
                    </Card.Body>
                </Card>
            </Col>

            <Modal open={confirmOpen.value} onClose={() => { confirmOpen.value = false; }}>
                <Modal.Header>
                    <Heading level={3}>Clear all data?</Heading>
                </Modal.Header>
                <Modal.Body>
                    <Text>
                        This will permanently remove every trip and entry.
                        This action cannot be undone.
                    </Text>
                </Modal.Body>
                <Modal.Actions>
                    <Button variant="ghost" onPress={() => { confirmOpen.value = false; }}>
                        Cancel
                    </Button>
                    <Button variant="error" onPress={onClear}>
                        Clear
                    </Button>
                </Modal.Actions>
            </Modal>
        </ScrollView>
    );
});
