import {
    component,
    signal,
    runOnMainThread,
    useMainThreadRef,
    useSharedValue,
    useAnimatedStyle,
    type MainThread,
} from '@sigx/lynx';
import { withSpring, withTiming } from '@sigx/lynx-motion';
import { Screen } from '@sigx/lynx-navigation';
import { ScrollView } from '@sigx/lynx-gestures';
import { Button, Card, Col, Heading, Row, Text } from '@sigx/lynx-daisyui';
import { DemoSlider } from '../../components/DemoSlider.js';

const TRAVEL = 200;
const BOX = 44;

/**
 * Spring physics playground — `withSpring` / `withTiming` from
 * @sigx/lynx-motion, all running as main-thread worklets. The launch
 * worklet is registered once at setup and receives the live slider values
 * as call-time args (args cross the MT bridge; closures don't).
 */
export const SpringLab = component(() => {
    // ── Hero arena ───────────────────────────────────────────────────────
    const heroRef = useMainThreadRef<MainThread.Element | null>(null);
    const heroTx = useSharedValue(0);
    useAnimatedStyle(heroRef, heroTx, 'translateX');

    const stiffness = signal(180);
    const damping = signal(12);
    const mass = signal(1);
    const atEnd = signal(false);

    const launch = runOnMainThread((target: number, s: number, d: number, m: number) => {
        'main thread';
        withSpring(heroTx, target, { stiffness: s, damping: d, mass: m });
    });

    // ── Preset race ──────────────────────────────────────────────────────
    // Four lanes, one withSpring each, fired from a single MT worklet so
    // the physics run side by side. Individual consts (not an array) so the
    // worklet's `_c` capture stays simple and shape-stable.
    const lane0 = useSharedValue(0);
    const lane1 = useSharedValue(0);
    const lane2 = useSharedValue(0);
    const lane3 = useSharedValue(0);
    const laneRef0 = useMainThreadRef<MainThread.Element | null>(null);
    const laneRef1 = useMainThreadRef<MainThread.Element | null>(null);
    const laneRef2 = useMainThreadRef<MainThread.Element | null>(null);
    const laneRef3 = useMainThreadRef<MainThread.Element | null>(null);
    useAnimatedStyle(laneRef0, lane0, 'translateX');
    useAnimatedStyle(laneRef1, lane1, 'translateX');
    useAnimatedStyle(laneRef2, lane2, 'translateX');
    useAnimatedStyle(laneRef3, lane3, 'translateX');
    const raceAtEnd = signal(false);

    const race = runOnMainThread((target: number) => {
        'main thread';
        withSpring(lane0, target, { stiffness: 120, damping: 14 });
        withSpring(lane1, target, { stiffness: 180, damping: 6 });
        withSpring(lane2, target, { stiffness: 400, damping: 30 });
        withSpring(lane3, target, { stiffness: 60, damping: 20, mass: 4 });
    });

    // ── Choreography ─────────────────────────────────────────────────────
    // Sequencing via the `finished` promise: tween right, spring down, then
    // both back. `.then` chains keep everything inside the one MT worklet.
    const seqRef = useMainThreadRef<MainThread.Element | null>(null);
    const seqTx = useSharedValue(0);
    const seqTy = useSharedValue(0);
    useAnimatedStyle(seqRef, seqTx, 'translateX');
    useAnimatedStyle(seqRef, seqTy, 'translateY');

    const choreograph = runOnMainThread(() => {
        'main thread';
        withTiming(seqTx, TRAVEL, { duration: 0.25 })
            .then(() => withSpring(seqTy, 44, { stiffness: 300, damping: 12 }))
            .then(() => {
                withTiming(seqTx, 0, { duration: 0.3 });
                withSpring(seqTy, 0, { stiffness: 200, damping: 16 });
            });
    });

    const lanes = [
        { name: 'Gentle', desc: 'stiffness 120 · damping 14', ref: laneRef0 },
        { name: 'Wobbly', desc: 'stiffness 180 · damping 6', ref: laneRef1 },
        { name: 'Stiff', desc: 'stiffness 400 · damping 30', ref: laneRef2 },
        { name: 'Molasses', desc: 'stiffness 60 · damping 20 · mass 4', ref: laneRef3 },
    ];

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Spring Lab" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Spring Lab</Heading>
                <Text class="opacity-60 text-sm">
                    Physics-based animation on the main thread. Tune the spring, then
                    launch — mash the button mid-flight to see per-value auto-cancel
                    (the new spring takes over from the live position).
                </Text>

                <Card bordered>
                    <Card.Body>
                        <Col gap={12}>
                            <Text weight="semibold">Playground</Text>
                            <view
                                class="bg-base-200"
                                style={{ height: `${BOX + 24}px`, borderRadius: '12px', justifyContent: 'center', padding: '0 12px' }}
                            >
                                <view
                                    main-thread:ref={heroRef}
                                    class="bg-primary"
                                    style={{ width: `${BOX}px`, height: `${BOX}px`, borderRadius: '10px' }}
                                />
                            </view>
                            <DemoSlider label="stiffness" min={10} max={400} initial={180}
                                onChange={(v) => { stiffness.value = v; }} />
                            <DemoSlider label="damping" min={2} max={60} initial={12}
                                onChange={(v) => { damping.value = v; }} />
                            <DemoSlider label="mass" min={0.5} max={4} initial={1} decimals={1}
                                onChange={(v) => { mass.value = v; }} />
                            <Button
                                color="primary"
                                onPress={() => {
                                    const target = atEnd.value ? 0 : TRAVEL;
                                    atEnd.value = !atEnd.value;
                                    launch(target, stiffness.value, damping.value, mass.value);
                                }}
                            >
                                Launch spring
                            </Button>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={12}>
                            <Text weight="semibold">Preset race</Text>
                            <Text class="opacity-60 text-sm">
                                Four springs, one worklet, fired together — compare the
                                regimes side by side.
                            </Text>
                            {lanes.map((lane) => (
                                <Col key={lane.name} gap={2}>
                                    <Row justify="space-between">
                                        <Text class="text-xs">{lane.name}</Text>
                                        <Text class="text-xs opacity-50">{lane.desc}</Text>
                                    </Row>
                                    <view
                                        class="bg-base-200"
                                        style={{ height: '28px', borderRadius: '8px', justifyContent: 'center', padding: '0 6px' }}
                                    >
                                        <view
                                            main-thread:ref={lane.ref}
                                            class="bg-secondary"
                                            style={{ width: '20px', height: '20px', borderRadius: '6px' }}
                                        />
                                    </view>
                                </Col>
                            ))}
                            <Button
                                color="secondary"
                                variant="outline"
                                onPress={() => {
                                    const target = raceAtEnd.value ? 0 : TRAVEL;
                                    raceAtEnd.value = !raceAtEnd.value;
                                    race(target);
                                }}
                            >
                                Race!
                            </Button>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={12}>
                            <Text weight="semibold">Choreography</Text>
                            <Text class="opacity-60 text-sm">
                                Sequencing with the `finished` promise: tween right, spring
                                down, return — one main-thread worklet, zero BG round trips.
                            </Text>
                            <view
                                class="bg-base-200"
                                style={{ height: '110px', borderRadius: '12px', padding: '10px' }}
                            >
                                <view
                                    main-thread:ref={seqRef}
                                    class="bg-accent"
                                    style={{ width: '36px', height: '36px', borderRadius: '18px' }}
                                />
                            </view>
                            <Button variant="outline" onPress={() => choreograph()}>
                                Run sequence
                            </Button>
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
