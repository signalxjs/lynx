import {
    component,
    signal,
    useMainThreadRef,
    useSharedValue,
    useAnimatedStyle,
    Gesture,
    useGestureDetector,
    type MainThread,
} from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { usePinch, useRotation, type TouchEvent } from '@sigx/lynx-gestures';
import { Button, Card, Col, Heading, ScrollView, Text } from '@sigx/lynx-daisyui';
import { DemoSlider } from '../../components/DemoSlider.js';

const clampScale = (v: number): number => Math.min(3, Math.max(0.5, v));

/**
 * Pinch & rotate — two implementations side by side:
 *
 * 1. **Arena** `Gesture.Pinch()`/`Gesture.Rotation()` via `useGestureDetector`
 *    — recognized by the web gesture recognizer in the browser (`sigx
 *    run:web`); the native arena handlers are unfinished in Lynx 3.5
 *    (signalxjs/lynx#418), so on native this pad stays inert for now. The
 *    transform runs entirely on the main thread via SharedValues.
 * 2. **Legacy hooks** `usePinch`/`useRotation` parsing raw `bindtouch*` events
 *    on the background thread — works on native multi-touch hosts.
 *
 * Sliders drive the legacy pad's signals as a fallback for hosts without
 * multi-touch input.
 */
export const PinchRotateDemo = component(() => {
    // ── Pad 1: arena Pinch + Rotation (web recognizer) ───────────────────
    const arenaRef = useMainThreadRef<MainThread.Element | null>(null);
    const arenaScale = useSharedValue(1);
    const arenaRot = useSharedValue(0); // degrees
    useAnimatedStyle(arenaRef, arenaScale, 'scale');
    useAnimatedStyle(arenaRef, arenaRot, 'rotate');
    // Gesture callbacks are separate worklets — cross-callback state lives in
    // a MainThreadRef (same idiom as GestureLab's pan state).
    const arenaBase = useMainThreadRef<{ scale: number; rot: number }>({ scale: 1, rot: 0 });

    const arenaPinch = Gesture.Pinch()
        .onBegin(() => {
            'main thread';
        })
        .onStart(() => {
            'main thread';
            arenaBase.current.scale = arenaScale.current.value;
        })
        .onUpdate((e: any) => {
            'main thread';
            const s = (e && e.params && e.params.scale) || 1;
            arenaScale.current.value = Math.min(3, Math.max(0.5, arenaBase.current.scale * s));
            const __flush = (globalThis as Record<string, unknown>)['__FlushElementTree'] as (() => void) | undefined;
            if (__flush) __flush();
        });

    const arenaRotation = Gesture.Rotation()
        .onBegin(() => {
            'main thread';
        })
        .onStart(() => {
            'main thread';
            arenaBase.current.rot = arenaRot.current.value;
        })
        .onUpdate((e: any) => {
            'main thread';
            const r = (e && e.params && e.params.rotation) || 0; // radians
            arenaRot.current.value = arenaBase.current.rot + (r * 180) / Math.PI;
            const __flush = (globalThis as Record<string, unknown>)['__FlushElementTree'] as (() => void) | undefined;
            if (__flush) __flush();
        });

    useGestureDetector(arenaRef, Gesture.Simultaneous(arenaPinch, arenaRotation));

    // ── Pad 2: legacy BG hooks ───────────────────────────────────────────
    const scale = signal(1);
    const angle = signal(0);
    let baseScale = 1;
    let baseAngle = 0;

    const pinch = usePinch({
        onPinch: (s) => {
            if (s.phase === 'active') scale.value = clampScale(baseScale * s.scale);
            else if (s.phase === 'ended' || s.phase === 'cancelled') baseScale = scale.value;
        },
    });
    const rotation = useRotation({
        onRotation: (r) => {
            if (r.phase === 'active') angle.value = baseAngle + (r.rotation * 180) / Math.PI;
            else if (r.phase === 'ended' || r.phase === 'cancelled') baseAngle = angle.value;
        },
    });

    // Both hooks consume the same touch stream — fan each event out.
    const fan = (key: keyof typeof pinch.handlers) => (e: TouchEvent): void => {
        pinch.handlers[key]?.(e);
        rotation.handlers[key]?.(e);
    };
    const onTouchStart = fan('bindtouchstart');
    const onTouchMove = fan('bindtouchmove');
    const onTouchEnd = fan('bindtouchend');
    const onTouchCancel = fan('bindtouchcancel');

    const reset = (): void => {
        baseScale = 1;
        baseAngle = 0;
        scale.value = 1;
        angle.value = 0;
        pinch.reset();
        rotation.reset();
    };

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Pinch & Rotate" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Pinch &amp; rotate</Heading>
                <Text class="opacity-60 text-sm">
                    Two-finger pinch to zoom, twist to rotate. Needs real multi-touch —
                    on the iOS simulator hold ⌥ Option and drag; if your host doesn't
                    deliver multi-touch, the sliders below drive the same transform.
                </Text>

                <Card bordered>
                    <Card.Body>
                        <Col gap={12} align="center">
                            <Text weight="semibold">Arena — Gesture.Pinch() + Gesture.Rotation()</Text>
                            <Text class="text-xs opacity-60">
                                Recognized in the browser (sigx run:web) — use DevTools touch
                                emulation or a touch screen. Inert on native until #418 lands.
                            </Text>
                            <view
                                style={{ height: '220px', width: '100%', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
                            >
                                <view
                                    main-thread:ref={arenaRef}
                                    class="bg-secondary"
                                    style={{
                                        width: '140px',
                                        height: '140px',
                                        borderRadius: '20px',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <text style={{ fontSize: '52px' }}>🧭</text>
                                </view>
                            </view>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={12} align="center">
                            <Text weight="semibold">Legacy — usePinch() + useRotation()</Text>
                            <view
                                style={{ height: '260px', width: '100%', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
                                bindtouchstart={onTouchStart}
                                bindtouchmove={onTouchMove}
                                bindtouchend={onTouchEnd}
                                bindtouchcancel={onTouchCancel}
                            >
                                <view
                                    class="bg-primary"
                                    style={{
                                        width: '140px',
                                        height: '140px',
                                        borderRadius: '20px',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        transform: `scale(${scale.value}) rotate(${angle.value}deg)`,
                                    }}
                                >
                                    <text style={{ fontSize: '52px' }}>🖼️</text>
                                </view>
                            </view>
                            <Text class="text-xs opacity-60">
                                scale {scale.value.toFixed(2)} · rotation {Math.round(angle.value)}°
                            </Text>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={12}>
                            <Text weight="semibold">No multi-touch? Same signals:</Text>
                            <DemoSlider label="scale" min={0.5} max={3} initial={1} decimals={2}
                                onChange={(v) => { scale.value = v; baseScale = v; }} />
                            <DemoSlider label="rotation" min={-180} max={180} initial={0}
                                onChange={(v) => { angle.value = v; baseAngle = v; }} />
                            <Button variant="outline" size="sm" onPress={reset}>Reset</Button>
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
