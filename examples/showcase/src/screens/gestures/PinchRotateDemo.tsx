import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { PinchRotate } from '@sigx/lynx-gestures';
import { Button, Card, Col, Heading, ScrollView, Text } from '@sigx/lynx-daisyui';
import { DemoSlider } from '../../components/DemoSlider.js';

const DEG = 180 / Math.PI;

/**
 * Pinch & rotate — one native card.
 *
 * `<PinchRotate>` wraps the native `<sigx-pinch>` element, which attaches
 * UIKit's `UIPinchGestureRecognizer` + `UIRotationGestureRecognizer` (iOS) and
 * a `ScaleGestureDetector` + rotation tracker (Android) to its backing view.
 * The transform is applied natively on the UI thread, so it stays smooth under
 * the finger. Lynx ships no native pinch/rotation gesture of its own
 * (signalxjs/lynx#418), so this is the real thing rather than `Gesture.*`.
 *
 * The card is also *controlled*: `scale`/`rotation` props drive it from the
 * sliders, for hosts without multi-touch. Gesture and sliders stay in sync —
 * a pinch fires `change`, which updates the same signals the sliders write.
 */
export const PinchRotateDemo = component(() => {
    const scale = signal(1);
    const angleDeg = signal(0);

    const reset = (): void => {
        scale.value = 1;
        angleDeg.value = 0;
    };

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Pinch & Rotate" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Pinch &amp; rotate</Heading>
                <Text class="opacity-60 text-sm">
                    Two-finger pinch to zoom, twist to rotate — a native gesture
                    (UIKit / Android recognizers), applied on the UI thread. Needs real
                    multi-touch: on the iOS simulator hold ⌥ Option and drag. No
                    multi-touch? The sliders drive the same card.
                </Text>

                <Card bordered>
                    <Card.Body>
                        <Col gap={12} align="center">
                            <Text weight="semibold">&lt;PinchRotate&gt; — native</Text>
                            <view
                                style={{ height: '300px', width: '100%', alignItems: 'center', justifyContent: 'center' }}
                            >
                                <PinchRotate
                                    minScale={0.5}
                                    maxScale={4}
                                    scale={scale.value}
                                    rotation={angleDeg.value / DEG}
                                    onChange={(e) => {
                                        scale.value = e.scale;
                                        angleDeg.value = e.rotation * DEG;
                                    }}
                                    style={{ width: '140px', height: '140px', alignItems: 'center', justifyContent: 'center' }}
                                >
                                    <view
                                        class="bg-primary"
                                        style={{
                                            width: '140px',
                                            height: '140px',
                                            borderRadius: '20px',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}
                                    >
                                        <text style={{ fontSize: '52px' }}>🖼️</text>
                                    </view>
                                </PinchRotate>
                            </view>
                            <Text class="text-xs opacity-60">
                                scale {scale.value.toFixed(2)} · rotation {Math.round(angleDeg.value)}°
                            </Text>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={12}>
                            <Text weight="semibold">No multi-touch? Same card:</Text>
                            <DemoSlider label="scale" min={0.5} max={4} initial={1} decimals={2}
                                onChange={(v) => { scale.value = v; }} />
                            <DemoSlider label="rotation" min={-180} max={180} initial={0}
                                onChange={(v) => { angleDeg.value = v; }} />
                            <Button variant="outline" size="sm" onPress={reset}>Reset</Button>
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
