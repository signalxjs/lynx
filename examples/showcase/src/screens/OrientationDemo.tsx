import { component, Orientation, signal, useScreen } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, Heading, Row, ScrollView, Text } from '@sigx/lynx-daisyui';
import { useSafeAreaInsets } from '@sigx/lynx-safe-area';
import { Haptics } from '@sigx/lynx-haptics';

/**
 * Orientation & screen metrics (#856).
 *
 * Three things to check by rotating the device with this screen open:
 *
 *  1. **The readout follows the rotation** — `useScreen()` is fed by the
 *     native `ScreenMetricsPublisher`, so width/height/orientation update
 *     live. `Platform.pixelWidth` (also shown) is a load-time snapshot and
 *     deliberately does NOT move: that contrast is the point.
 *  2. **The tap counter survives** — proof the app rotated *in place*. Before
 *     this change Android recreated the Activity on rotation and reloaded the
 *     bundle, resetting everything.
 *  3. **The grid reflows** — 1 column in portrait, 2 in landscape, driven off
 *     the live width rather than a fixed breakpoint snapshot.
 *
 * The lock buttons exercise the runtime API. They only work because
 * `signalx.config.ts` declares `orientation: 'default'`; a portrait-locked
 * build makes `Orientation.lock('landscape')` reject with a message saying so.
 */
export const OrientationDemo = component(() => {
    const screen = useScreen();
    const insets = useSafeAreaInsets();
    const taps = signal({ count: 0 });
    // Surfaces the rejection path — a portrait-only build reports it here
    // rather than failing silently.
    const lockError = signal({ message: '' });

    const request = (fn: () => Promise<void>) => {
        Haptics.selection();
        lockError.message = '';
        fn().catch((e: unknown) => {
            lockError.message = e instanceof Error ? e.message : String(e);
        });
    };

    return () => {
        const s = screen.value;
        const columns = s.isLandscape ? 2 : 1;
        const tiles = ['Alpha', 'Beta', 'Gamma', 'Delta'];
        // Screen padding 16 + Card.Body padding ~16 each side, minus the
        // inter-tile gap. Recomputed on every rotation, which is the point.
        const tileW = Math.floor((s.width - 64 - (columns - 1) * 8) / columns);

        return (
            <ScrollView class="flex-fill bg-base-100">
                <Screen title="Orientation" />
                <Col gap={16} padding={16}>
                    <Heading level={2}>Orientation</Heading>

                    <Card bordered>
                        <Card.Body>
                            <Col gap={8}>
                                <Text weight="semibold">Live screen metrics</Text>
                                <Text class="opacity-60 text-sm">
                                    `useScreen()` — republished by the native
                                    ScreenMetricsPublisher on every viewport change.
                                </Text>
                                <Row gap={8} wrap>
                                    <Text class="font-mono text-sm">
                                        {s.width} × {s.height} dp
                                    </Text>
                                    <Text class="font-mono text-sm opacity-60">
                                        @{s.scale}×
                                    </Text>
                                </Row>
                                <Text class="font-mono text-sm">
                                    orientation: {s.orientation}
                                    {s.isLandscape ? ' (landscape)' : ' (portrait)'}
                                </Text>
                                <Text class="font-mono text-sm opacity-60">
                                    safe area: {Math.round(insets.value.top)} /{' '}
                                    {Math.round(insets.value.right)} /{' '}
                                    {Math.round(insets.value.bottom)} /{' '}
                                    {Math.round(insets.value.left)}
                                </Text>
                            </Col>
                        </Card.Body>
                    </Card>

                    <Card bordered>
                        <Card.Body>
                            <Col gap={8}>
                                <Text weight="semibold">Rotated in place?</Text>
                                <Text class="opacity-60 text-sm">
                                    Tap a few times, then rotate. If the count survives,
                                    the bundle was never reloaded — the whole point of
                                    the manifest's `configChanges` and the iOS viewport
                                    push.
                                </Text>
                                <Row gap={12} align="center">
                                    <Button
                                        size="sm"
                                        onPress={() => {
                                            Haptics.selection();
                                            taps.count += 1;
                                        }}
                                    >
                                        Tap
                                    </Button>
                                    <Text class="font-mono">count: {taps.count}</Text>
                                </Row>
                            </Col>
                        </Card.Body>
                    </Card>

                    <Card bordered>
                        <Card.Body>
                            <Col gap={8}>
                                <Text weight="semibold">
                                    Reflowing layout ({columns} column{columns > 1 ? 's' : ''})
                                </Text>
                                <Text class="opacity-60 text-sm">
                                    Driven off the live width, not a snapshot.
                                </Text>
                                {/* Raw <view> with an explicit px width: lynx-zero's
                                    Col/Row drop `style`, and a `%` width wouldn't
                                    reflow anyway — the point is that `tileW` is
                                    derived from the live screen width. */}
                                <view
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'row',
                                        flexWrap: 'wrap',
                                        gap: '8px',
                                    }}
                                >
                                    {tiles.map((label) => (
                                        <view
                                            key={label}
                                            class="bg-base-200 rounded-box"
                                            style={{
                                                display: 'flex',
                                                flexDirection: 'column',
                                                // border-box, else the 12px
                                                // padding pushes each tile past
                                                // its share and nothing wraps
                                                // into the second column.
                                                boxSizing: 'border-box',
                                                // Percentage of the card body,
                                                // so the tiles don't depend on
                                                // guessing the ancestors' padding.
                                                width: columns === 2 ? '48%' : '100%',
                                                padding: '12px',
                                            }}
                                        >
                                            <Text weight="semibold">{label}</Text>
                                            <Text class="opacity-60 text-sm">
                                                {tileW} dp wide
                                            </Text>
                                        </view>
                                    ))}
                                </view>
                            </Col>
                        </Card.Body>
                    </Card>

                    <Card bordered>
                        <Card.Body>
                            <Col gap={8}>
                                <Text weight="semibold">Runtime lock</Text>
                                <Text class="opacity-60 text-sm">
                                    `Orientation.lock()` / `.unlock()`. The build-time
                                    `orientation` in signalx.config.ts is the ceiling: a
                                    portrait-only build makes `lock('landscape')` reject
                                    with a message saying so, instead of silently doing
                                    nothing. This app declares 'default'.
                                </Text>
                                <Row gap={8} wrap>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onPress={() => request(() => Orientation.lock('portrait'))}
                                    >
                                        Lock portrait
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onPress={() => request(() => Orientation.lock('landscape'))}
                                    >
                                        Lock landscape
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onPress={() => request(() => Orientation.unlock())}
                                    >
                                        Unlock
                                    </Button>
                                </Row>
                                {lockError.message ? (
                                    <Text class="text-error text-sm">{lockError.message}</Text>
                                ) : null}
                                <Text class="opacity-60 text-sm">
                                    Use `useOrientationLock('landscape')` when a single
                                    screen should hold the lock for its lifetime.
                                </Text>
                            </Col>
                        </Card.Body>
                    </Card>
                </Col>
            </ScrollView>
        );
    };
});
