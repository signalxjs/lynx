import {
    component,
    signal,
    useMainThreadRef,
    useSharedValue,
    useAnimatedStyle,
    Gesture,
    useGestureDetector,
    runOnBackground,
    type MainThread,
} from '@sigx/lynx';
import { withSpring } from '@sigx/lynx-motion';
import { Screen } from '@sigx/lynx-navigation';
import { Pressable } from '@sigx/lynx-gestures';
import { Haptics } from '@sigx/lynx-haptics';
import { Card, Col, Heading, Row, ScrollView, Text } from '@sigx/lynx-daisyui';

const TILE = 84;

/**
 * Press feedback gallery — `<Pressable>`'s visual feedback surface
 * (pressedOpacity × pressedScale), long-press durations, movement-cancel,
 * disabled state, and a build-your-own tile from raw `Gesture.Tap()` +
 * `withSpring` showing what the component does under the hood.
 */
export const PressFeedbackDemo = component(() => {
    const presses = signal(0);
    const longPresses = signal(0);

    // Build-your-own: a tap worklet pulsing a scale SharedValue. One spring
    // down, then chain back up off the `finished` promise — all on MT.
    const byoRef = useMainThreadRef<MainThread.Element | null>(null);
    const byoScale = useSharedValue(1);
    useAnimatedStyle(byoRef, byoScale, 'scale');

    const byoTap = Gesture.Tap()
        .maxDistance(16)
        .onBegin(() => {
            'main thread';
            withSpring(byoScale, 0.86, { stiffness: 650, damping: 20 }).then(() => {
                withSpring(byoScale, 1, { stiffness: 280, damping: 12 });
            });
            runOnBackground(() => {
                Haptics.impact('light');
            })();
        });
    useGestureDetector(byoRef, byoTap);

    const tileStyle = {
        width: `${TILE}px`,
        height: `${TILE}px`,
        borderRadius: '14px',
        alignItems: 'center',
        justifyContent: 'center',
    } as const;

    const tile = (
        label: string,
        cls: string,
        opts: { opacity?: number; scale?: number; duration?: number; maxDistance?: number; disabled?: boolean },
    ) => (
        <Pressable
            pressedOpacity={opts.opacity}
            pressedScale={opts.scale}
            longPressDuration={opts.duration}
            maxDistance={opts.maxDistance}
            disabled={opts.disabled}
            onPress={() => {
                presses.value += 1;
                Haptics.impact('light');
            }}
            onLongPress={() => {
                longPresses.value += 1;
                Haptics.impact('heavy');
            }}
        >
            <view class={cls} style={{ ...tileStyle, opacity: opts.disabled ? 0.4 : 1 }}>
                <text style={{ color: 'white', fontSize: '11px', textAlign: 'center' }}>{label}</text>
            </view>
        </Pressable>
    );

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Press Feedback" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Press feedback</Heading>
                <Row justify="space-between">
                    <Text class="text-xs opacity-60">presses: {presses.value}</Text>
                    <Text class="text-xs opacity-60">long-presses: {longPresses.value}</Text>
                </Row>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">pressedOpacity</Text>
                            <Row gap={10} wrap>
                                {tile('0.8', 'bg-primary', { opacity: 0.8 })}
                                {tile('0.5', 'bg-primary', { opacity: 0.5 })}
                                {tile('0.25', 'bg-primary', { opacity: 0.25 })}
                            </Row>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">pressedScale</Text>
                            <Row gap={10} wrap>
                                {tile('0.96', 'bg-secondary', { scale: 0.96, opacity: 1 })}
                                {tile('0.9', 'bg-secondary', { scale: 0.9, opacity: 1 })}
                                {tile('both', 'bg-secondary', { scale: 0.92, opacity: 0.6 })}
                            </Row>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Long-press &amp; cancel</Text>
                            <Text class="opacity-60 text-xs">
                                Hold for the long-press counter; slide your finger off a tile
                                past maxDistance to cancel the press entirely.
                            </Text>
                            <Row gap={10} wrap>
                                {tile('hold 300ms', 'bg-accent', { duration: 300 })}
                                {tile('hold 800ms', 'bg-accent', { duration: 800 })}
                                {tile('strict 10px', 'bg-accent', { maxDistance: 10 })}
                                {tile('disabled', 'bg-accent', { disabled: true })}
                            </Row>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Build your own</Text>
                            <Text class="opacity-60 text-xs">
                                Raw Gesture.Tap() driving a scale SharedValue with two chained
                                springs — what Pressable does under the hood, ~10 lines.
                            </Text>
                            <view
                                main-thread:ref={byoRef}
                                class="bg-info"
                                style={tileStyle}
                            >
                                <text style={{ color: 'white', fontSize: '11px' }}>tap me</text>
                            </view>
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
