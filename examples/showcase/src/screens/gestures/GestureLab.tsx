import {
    component,
    signal,
    runOnBackground,
    useMainThreadRef,
    useSharedValue,
    useAnimatedStyle,
    Gesture,
    useGestureDetector,
    type MainThread,
} from '@sigx/lynx';
import { withSpring, withTiming } from '@sigx/lynx-motion';
import { Screen } from '@sigx/lynx-navigation';
import { ScrollView } from '@sigx/lynx-gestures';
import { Card, Col, Heading, Text } from '@sigx/lynx-daisyui';

const PAD_H = 104;

interface PanState {
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
}

/**
 * Gesture composition lab — raw `Gesture.*` builders wired with
 * `useGestureDetector`, composed three ways (Race / Simultaneous /
 * Exclusive). Every recognizer logs its lifecycle to the event feed via
 * `runOnBackground`, so the arena's claim semantics become visible.
 * Per-pad drag state lives in `useMainThreadRef` — gesture callbacks are
 * separate worklets, so shared mutable state can't live in a plain closure.
 */
export const GestureLab = component(() => {
    const log = signal<string[]>([]);
    const pushLog = (msg: string): void => {
        log.$set([msg, ...log].slice(0, 8));
    };

    // ── Pad A — Race(Pan, LongPress): first to claim wins ────────────────
    const aRef = useMainThreadRef<MainThread.Element | null>(null);
    const aGlowRef = useMainThreadRef<MainThread.Element | null>(null);
    const aTx = useSharedValue(0);
    const aTy = useSharedValue(0);
    const aGlow = useSharedValue(0);
    useAnimatedStyle(aRef, aTx, 'translateX');
    useAnimatedStyle(aRef, aTy, 'translateY');
    useAnimatedStyle(aGlowRef, aGlow, 'opacity');
    const aState = useMainThreadRef<PanState>({ startX: 0, startY: 0, offsetX: 0, offsetY: 0 });

    const aPan = Gesture.Pan()
        .minDistance(8)
        // Empty onBegin gates `_isInvokedBegin` open on iOS (see Draggable).
        .onBegin(() => {
            'main thread';
        })
        .onStart((e: any) => {
            'main thread';
            const p = e && e.params;
            aState.current.startX = (p && p.pageX) || 0;
            aState.current.startY = (p && p.pageY) || 0;
            aState.current.offsetX = aTx.current.value;
            aState.current.offsetY = aTy.current.value;
            runOnBackground(() => pushLog('A · pan won the race → dragging'))();
        })
        .onUpdate((e: any) => {
            'main thread';
            const p = e && e.params;
            aTx.current.value = aState.current.offsetX + ((p && p.pageX) || 0) - aState.current.startX;
            aTy.current.value = aState.current.offsetY + ((p && p.pageY) || 0) - aState.current.startY;
            const __flush = (globalThis as Record<string, unknown>)['__FlushElementTree'] as (() => void) | undefined;
            if (__flush) __flush();
        })
        .onEnd(() => {
            'main thread';
            withSpring(aTx, 0, { stiffness: 260, damping: 20 });
            withSpring(aTy, 0, { stiffness: 260, damping: 20 });
            runOnBackground(() => pushLog('A · pan end → spring back'))();
        });

    const aHold = Gesture.LongPress()
        .minDuration(350)
        .onStart(() => {
            'main thread';
            withTiming(aGlow, 0.45, { duration: 0.2 });
            runOnBackground(() => pushLog('A · long-press won the race → tint'))();
        })
        .onEnd(() => {
            'main thread';
            withTiming(aGlow, 0, { duration: 0.3 });
        });

    useGestureDetector(aRef, Gesture.Race(aPan, aHold));

    // ── Pad B — Simultaneous(Pan, LongPress): both fire at once ─────────
    const bRef = useMainThreadRef<MainThread.Element | null>(null);
    const bTx = useSharedValue(0);
    const bTy = useSharedValue(0);
    const bScale = useSharedValue(1);
    useAnimatedStyle(bRef, bTx, 'translateX');
    useAnimatedStyle(bRef, bTy, 'translateY');
    useAnimatedStyle(bRef, bScale, 'scale');
    const bState = useMainThreadRef<PanState>({ startX: 0, startY: 0, offsetX: 0, offsetY: 0 });

    const bPan = Gesture.Pan()
        .minDistance(8)
        .onBegin(() => {
            'main thread';
        })
        .onStart((e: any) => {
            'main thread';
            const p = e && e.params;
            bState.current.startX = (p && p.pageX) || 0;
            bState.current.startY = (p && p.pageY) || 0;
            bState.current.offsetX = bTx.current.value;
            bState.current.offsetY = bTy.current.value;
            runOnBackground(() => pushLog('B · pan start (concurrent)'))();
        })
        .onUpdate((e: any) => {
            'main thread';
            const p = e && e.params;
            bTx.current.value = bState.current.offsetX + ((p && p.pageX) || 0) - bState.current.startX;
            bTy.current.value = bState.current.offsetY + ((p && p.pageY) || 0) - bState.current.startY;
            const __flush = (globalThis as Record<string, unknown>)['__FlushElementTree'] as (() => void) | undefined;
            if (__flush) __flush();
        })
        .onEnd(() => {
            'main thread';
            withSpring(bTx, 0, { stiffness: 260, damping: 20 });
            withSpring(bTy, 0, { stiffness: 260, damping: 20 });
        });

    const bHold = Gesture.LongPress()
        .minDuration(350)
        .onStart(() => {
            'main thread';
            withSpring(bScale, 1.12, { stiffness: 400, damping: 18 });
            runOnBackground(() => pushLog('B · long-press start (concurrent) → grow'))();
        })
        .onEnd(() => {
            'main thread';
            withSpring(bScale, 1, { stiffness: 300, damping: 16 });
        });

    useGestureDetector(bRef, Gesture.Simultaneous(bPan, bHold));

    // ── Pad C — Exclusive(Fling, Pan): pan waits for fling to fail ──────
    const cRef = useMainThreadRef<MainThread.Element | null>(null);
    const cTx = useSharedValue(0);
    const cScale = useSharedValue(1);
    useAnimatedStyle(cRef, cTx, 'translateX');
    useAnimatedStyle(cRef, cScale, 'scale');
    const cState = useMainThreadRef<PanState>({ startX: 0, startY: 0, offsetX: 0, offsetY: 0 });

    const cFling = Gesture.Fling()
        .direction('right')
        .onStart(() => {
            'main thread';
            // Pulse: a quick stiff spring out, then settle home.
            withSpring(cScale, 1.25, { stiffness: 700, damping: 16 }).then(() => {
                withSpring(cScale, 1, { stiffness: 250, damping: 14 });
            });
            runOnBackground(() => pushLog('C · fling-right recognized → pulse'))();
        });

    const cPan = Gesture.Pan()
        .minDistance(8)
        .onBegin(() => {
            'main thread';
        })
        .onStart((e: any) => {
            'main thread';
            const p = e && e.params;
            cState.current.startX = (p && p.pageX) || 0;
            cState.current.offsetX = cTx.current.value;
            runOnBackground(() => pushLog('C · slow drag → pan (fling failed)'))();
        })
        .onUpdate((e: any) => {
            'main thread';
            const p = e && e.params;
            cTx.current.value = cState.current.offsetX + ((p && p.pageX) || 0) - cState.current.startX;
            const __flush = (globalThis as Record<string, unknown>)['__FlushElementTree'] as (() => void) | undefined;
            if (__flush) __flush();
        })
        .onEnd(() => {
            'main thread';
            withSpring(cTx, 0, { stiffness: 260, damping: 20 });
        });

    useGestureDetector(cRef, Gesture.Exclusive(cFling, cPan));

    const pad = (
        ref: typeof aRef,
        cls: string,
        label: string,
        glowRef?: typeof aRef,
    ) => (
        <view
            class="bg-base-200"
            style={{ height: `${PAD_H}px`, borderRadius: '14px', alignItems: 'center', justifyContent: 'center' }}
        >
            <view
                main-thread:ref={ref}
                class={cls}
                style={{
                    width: '72px',
                    height: '72px',
                    borderRadius: '16px',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    overflow: 'hidden',
                }}
            >
                {glowRef ? (
                    <view
                        main-thread:ref={glowRef}
                        style={{
                            position: 'absolute',
                            left: '0',
                            top: '0',
                            right: '0',
                            bottom: '0',
                            backgroundColor: 'white',
                            opacity: 0,
                        }}
                    />
                ) : null}
                <text style={{ color: 'white', fontSize: '12px' }}>{label}</text>
            </view>
        </view>
    );

    const section = (title: string, desc: string, body: unknown) => (
        <Card bordered>
            <Card.Body>
                <Col gap={8}>
                    <Text weight="semibold">{title}</Text>
                    <Text class="opacity-60 text-xs">{desc}</Text>
                    {body}
                </Col>
            </Card.Body>
        </Card>
    );

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Gesture Lab" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Gesture composition</Heading>
                <Text class="opacity-60 text-sm">
                    Raw Gesture builders attached with useGestureDetector. Watch the
                    event feed to see which recognizer the arena lets through.
                </Text>

                <Card bordered>
                    <Card.Body>
                        <Col gap={4}>
                            <Text weight="semibold" class="text-sm">Event feed</Text>
                            {log.length === 0
                                ? <Text class="text-xs opacity-40">interact with a pad below…</Text>
                                : log.map((line, i) => (
                                    <Text key={i} class={i === 0 ? 'text-xs' : 'text-xs opacity-40'}>{line}</Text>
                                ))}
                        </Col>
                    </Card.Body>
                </Card>

                {section(
                    'Race — first claim wins',
                    'Drag immediately to pan, or hold still 350ms to long-press. Only one fires.',
                    pad(aRef, 'bg-primary', 'drag / hold', aGlowRef),
                )}
                {section(
                    'Simultaneous — both fire',
                    'Hold to grow, then drag while holding — pan and long-press run together on different SharedValues.',
                    pad(bRef, 'bg-secondary', 'hold + drag'),
                )}
                {section(
                    'Exclusive — ordered fallback',
                    'Flick right fast for the fling pulse; drag slowly and pan takes over once fling fails.',
                    pad(cRef, 'bg-accent', 'flick →'),
                )}
            </Col>
        </ScrollView>
    );
});
