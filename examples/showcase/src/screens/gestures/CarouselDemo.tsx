import {
    component,
    effect,
    signal,
    useMainThreadRef,
    useSharedValue,
    useAnimatedStyle,
    type Define,
    type MainThread,
} from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import {
    Swiper,
    useSwiperDotProgress,
    useSwiperDotScale,
    type SharedValue,
} from '@sigx/lynx-gestures';
import { Haptics } from '@sigx/lynx-haptics';
import { Card, Col, Heading, ScrollView, SwiperIndicator, Text } from '@sigx/lynx-daisyui';

declare const lynx:
    | { SystemInfo?: { pixelWidth?: number; pixelRatio?: number } }
    | undefined;

const PAGE_W = (() => {
    try {
        const info = typeof lynx !== 'undefined' ? lynx?.SystemInfo : undefined;
        const px = info?.pixelWidth;
        const pr = info?.pixelRatio || 1;
        // Screen padding is 16 per side.
        if (typeof px === 'number' && px > 0) return Math.round(px / pr) - 32;
    } catch { /* fall through */ }
    return 360;
})();
const PAGE_H = 300;

interface Slide {
    title: string;
    blurb: string;
    emoji: string;
    bg: string;
}

const SLIDES: Slide[] = [
    { title: 'Main-thread motion', blurb: 'Springs and tweens run as Lepus worklets — zero BG frames.', emoji: '🚀', bg: 'bg-primary' },
    { title: 'Gesture arena', blurb: 'Pan, tap, long-press, fling — composed with Race & friends.', emoji: '🖐️', bg: 'bg-secondary' },
    { title: 'SharedValues', blurb: 'One value, many bindings: transforms, opacity, layout.', emoji: '🔗', bg: 'bg-accent' },
    { title: 'Range mappers', blurb: 'Declarative interpolation drives this parallax.', emoji: '🌈', bg: 'bg-info' },
    { title: 'Native snap', blurb: 'The pager itself is a paging-enabled native scroll-view.', emoji: '📐', bg: 'bg-success' },
];

/**
 * Carousel & parallax — `<Swiper>` exposes its live pixel offset as a
 * SharedValue; per-slide range mappers derive the parallax (inner art
 * counter-translates) and the active-card scale pop, all on the main
 * thread. Two indicator flavors below: the prefab SwiperIndicator and a
 * hand-rolled dot row built from the `useSwiperDot*` hooks.
 */
export const CarouselDemo = component(() => {
    const offset = useSharedValue(0);
    const index = signal(0);

    // Haptic tick on page change, driven off the index signal (the Swiper's
    // typed generic cast hides its `pageChange` event from JSX).
    let lastPage = 0;
    effect(() => {
        const page = index.value;
        if (page !== lastPage) {
            lastPage = page;
            Haptics.selection();
        }
    });

    // Per-slide refs + bindings, created once at setup (per-iteration hook
    // call-sites are stable across renders). The input window spans the
    // neighbouring pages so the effect tracks the finger continuously.
    const artRefs = SLIDES.map(() => useMainThreadRef<MainThread.Element | null>(null));
    const cardRefs = SLIDES.map(() => useMainThreadRef<MainThread.Element | null>(null));
    SLIDES.forEach((_, i) => {
        const center = i * PAGE_W;
        useAnimatedStyle(artRefs[i]!, offset, 'translateX', {
            inputRange: [center - PAGE_W, center, center + PAGE_W],
            outputRange: [70, 0, -70],
            extrapolate: 'clamp',
        });
        useAnimatedStyle(cardRefs[i]!, offset, 'scale', {
            inputRange: [center - PAGE_W, center, center + PAGE_W],
            outputRange: [0.9, 1, 0.9],
            extrapolate: 'clamp',
        });
    });

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Carousel" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Carousel &amp; parallax</Heading>
                <Text class="opacity-60 text-sm">
                    Swipe through the pages — the art layer counter-translates and the
                    off-center cards shrink, both driven by the swiper's offset
                    SharedValue through range mappers.
                </Text>

                <Swiper
                    items={SLIDES}
                    width={PAGE_W}
                    height={PAGE_H}
                    offset={offset}
                    index={index}
                    renderItem={(slide, i) => (
                        <view style={{ width: '100%', height: '100%', padding: '8px' }}>
                            <view
                                main-thread:ref={cardRefs[i]!}
                                class={(slide as Slide).bg}
                                style={{
                                    flex: 1,
                                    borderRadius: '20px',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    overflow: 'hidden',
                                    padding: '20px',
                                }}
                            >
                                <view main-thread:ref={artRefs[i]!} style={{ alignItems: 'center' }}>
                                    <text style={{ fontSize: '64px' }}>{(slide as Slide).emoji}</text>
                                </view>
                                <text style={{ color: 'white', fontSize: '18px', fontWeight: 'bold', marginTop: '16px' }}>
                                    {(slide as Slide).title}
                                </text>
                                <text style={{ color: 'white', fontSize: '13px', opacity: 0.85, textAlign: 'center', marginTop: '6px' }}>
                                    {(slide as Slide).blurb}
                                </text>
                            </view>
                        </view>
                    )}
                />

                <Card bordered>
                    <Card.Body>
                        <Col gap={12} align="center">
                            <Text class="text-xs opacity-60">
                                Prefab indicator (pill variant) · page {index.value + 1} / {SLIDES.length}
                            </Text>
                            <SwiperIndicator
                                variant="pill"
                                count={SLIDES.length}
                                offset={offset}
                                pageWidth={PAGE_W}
                                index={index}
                            />
                            <Text class="text-xs opacity-60">
                                Hand-rolled via useSwiperDotScale + useSwiperDotProgress
                            </Text>
                            <CustomDots count={SLIDES.length} offset={offset} />
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});

type CustomDotsProps =
    & Define.Prop<'count', number, true>
    & Define.Prop<'offset', SharedValue<number>, true>;

/** Dot row built straight on the headless hooks — scale pulse + crossfade. */
const CustomDots = component<CustomDotsProps>(({ props }) => {
    const dots = Array.from({ length: props.count }, (_, i) => ({
        scaleRef: useSwiperDotScale({ offset: props.offset, pageWidth: PAGE_W, index: i, active: 1.5 }),
        fadeRef: useSwiperDotProgress({ offset: props.offset, pageWidth: PAGE_W, index: i, outputRange: [0.3, 1, 0.3] }),
    }));

    return () => (
        <view style={{ flexDirection: 'row', gap: '10px' }}>
            {dots.map((dot, i) => (
                <view key={i} main-thread:ref={dot.scaleRef}>
                    <view
                        main-thread:ref={dot.fadeRef}
                        class="bg-primary"
                        style={{ width: '8px', height: '8px', borderRadius: '4px' }}
                    />
                </view>
            ))}
        </view>
    );
});
