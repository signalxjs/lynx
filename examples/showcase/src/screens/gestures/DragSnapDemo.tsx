import {
    component,
    signal,
    runOnMainThread,
    useMainThreadRef,
    useSharedValue,
    useAnimatedStyle,
    type MainThread,
} from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Draggable, ScrollView } from '@sigx/lynx-gestures';
import { withSpring } from '@sigx/lynx-motion';
import { Card, Col, Heading, Text } from '@sigx/lynx-daisyui';

// Fixed arena geometry — shared by the Draggable bounds, the snap targets
// and the range-mapper input ranges, so nothing needs runtime measurement.
declare const lynx:
    | { SystemInfo?: { pixelWidth?: number; pixelRatio?: number } }
    | undefined;

const SCREEN_W = (() => {
    try {
        const info = typeof lynx !== 'undefined' ? lynx?.SystemInfo : undefined;
        const px = info?.pixelWidth;
        const pr = info?.pixelRatio || 1;
        if (typeof px === 'number' && px > 0) return Math.round(px / pr);
    } catch { /* fall through */ }
    return 400;
})();

const CARD = 72;
// Screen padding 16 + Card.Body padding ≈ 16 each side.
const ARENA_W = Math.max(SCREEN_W - 96, 220);
const ARENA_H = 280;
const MAX_X = ARENA_W - CARD;
const MAX_Y = ARENA_H - CARD;

/**
 * Drag, fling & snap — `<Draggable>` with external SharedValues + bounds.
 * On release the velocity from `dragEnd` projects a landing point; the card
 * springs to the nearest corner with the release velocity handed straight
 * into `withSpring`, so a flung card carries its momentum into the snap.
 */
export const DragSnapDemo = component(() => {
    const tx = useSharedValue(0);
    const ty = useSharedValue(0);

    // Garnish driven by the same SVs through range mappers — the glow strip
    // fades in as the card approaches the right edge, and the card scales up
    // slightly toward the bottom. Visuals on MT, zero BG frames during drag.
    const glowRef = useMainThreadRef<MainThread.Element | null>(null);
    useAnimatedStyle(glowRef, tx, 'opacity', {
        inputRange: [0, MAX_X],
        outputRange: [0, 0.35],
        extrapolate: 'clamp',
    });
    const cardInnerRef = useMainThreadRef<MainThread.Element | null>(null);
    useAnimatedStyle(cardInnerRef, ty, 'scale', {
        inputRange: [0, MAX_Y],
        outputRange: [1, 1.12],
        extrapolate: 'clamp',
    });

    const status = signal('Drag the card, then let go — flick it to throw.');

    const snapTo = runOnMainThread((cx: number, cy: number, vx: number, vy: number) => {
        'main thread';
        withSpring(tx, cx, { stiffness: 220, damping: 22, velocity: vx });
        withSpring(ty, cy, { stiffness: 220, damping: 22, velocity: vy });
    });

    const onDragEnd = (e: { x: number; y: number; vx: number; vy: number }): void => {
        // vx/vy are px/ms — project ~150ms ahead, then pick the nearest corner.
        const px = e.x + e.vx * 150;
        const py = e.y + e.vy * 150;
        const cx = px > MAX_X / 2 ? MAX_X : 0;
        const cy = py > MAX_Y / 2 ? MAX_Y : 0;
        // withSpring's `velocity` expects units/second.
        snapTo(cx, cy, e.vx * 1000, e.vy * 1000);
        const speed = Math.round(Math.sqrt(e.vx * e.vx + e.vy * e.vy) * 1000);
        status.value = `Released at ${Math.round(e.x)}, ${Math.round(e.y)} · ${speed} px/s → ${cx ? 'right' : 'left'}-${cy ? 'bottom' : 'top'}`;
    };

    const cornerStyle = (left: boolean, top: boolean): Record<string, string> => ({
        position: 'absolute',
        [left ? 'left' : 'right']: '6px',
        [top ? 'top' : 'bottom']: '6px',
        width: '18px',
        height: '18px',
        borderRadius: '9px',
    });

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Drag & Snap" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Drag, fling &amp; snap</Heading>
                <Text class="opacity-60 text-sm">
                    The pan worklet writes two SharedValues on the main thread; range
                    mappers derive the glow and scale from the same values. On release
                    the velocity hands off into withSpring for a physical throw.
                </Text>

                <Card bordered>
                    <Card.Body>
                        <Col gap={12}>
                            <view
                                class="bg-base-200"
                                style={{
                                    width: `${ARENA_W}px`,
                                    height: `${ARENA_H}px`,
                                    borderRadius: '16px',
                                    position: 'relative',
                                    overflow: 'hidden',
                                }}
                            >
                                <view class="bg-base-300" style={cornerStyle(true, true)} />
                                <view class="bg-base-300" style={cornerStyle(false, true)} />
                                <view class="bg-base-300" style={cornerStyle(true, false)} />
                                <view class="bg-base-300" style={cornerStyle(false, false)} />
                                <view
                                    main-thread:ref={glowRef}
                                    class="bg-primary"
                                    style={{
                                        position: 'absolute',
                                        right: '0',
                                        top: '0',
                                        bottom: '0',
                                        width: '24px',
                                        opacity: 0,
                                    }}
                                />
                                <Draggable
                                    axis="both"
                                    translateX={tx}
                                    translateY={ty}
                                    minX={0}
                                    maxX={MAX_X}
                                    minY={0}
                                    maxY={MAX_Y}
                                    onDragEnd={onDragEnd}
                                    style={{ position: 'absolute', left: '0', top: '0' }}
                                >
                                    <view
                                        main-thread:ref={cardInnerRef}
                                        class="bg-primary"
                                        style={{
                                            width: `${CARD}px`,
                                            height: `${CARD}px`,
                                            borderRadius: '16px',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}
                                    >
                                        <text style={{ fontSize: '28px' }}>🎯</text>
                                    </view>
                                </Draggable>
                            </view>
                            <Text class="text-xs opacity-60">{status.value}</Text>
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
