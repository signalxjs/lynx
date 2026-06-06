import { component, runOnMainThread, signal, useSharedValue } from '@sigx/lynx';
import { Button, Col, Row, SwiperIndicator, Text } from '@sigx/lynx-daisyui';
import { withTiming } from '@sigx/lynx-motion';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * SwiperIndicator — themed page indicator for a `<Swiper>` carousel, with five
 * preset variants (`dots`, `bar`, `pill`, `numbered`, `scale-pulse`) and a size
 * ramp (`xs` … `lg`).
 *
 * Animated variants (`dots` / `bar` / `pill` / `scale-pulse`) read a live MT
 * `offset` (`SharedValue<number>`, the Swiper's pixel scroll offset) plus a
 * `pageWidth` to drive their per-frame mappers — without both they render
 * nothing. `numbered` is pure BG-thread and needs only `index` + `count`.
 *
 * Here there is no real `<Swiper>`, so the live section drives `offset` itself
 * with `withTiming(offset, index * pageWidth)` on prev/next — exactly what a
 * Swiper would push — so the indicator animates between pages.
 */

/** Demo geometry — a stand-in for a real Swiper's page width / count. */
const PAGE_WIDTH = 240;
const COUNT = 5;

export const swiperindicatorDemo: DaisyComponentDemo = {
    id: 'swiperindicator',
    title: 'SwiperIndicator',
    description: 'Carousel page indicator — dots / bar / pill / numbered / scale-pulse variants & sizes',
    icon: { set: 'lucide', name: 'ellipsis' },
    sections: [
        {
            title: 'Variants',
            note: 'each reads the same offset/pageWidth; numbered is pure BG-thread',
            Demo: component(() => {
                // A static, mid-scroll offset so every animated variant shows
                // its active page (page index 2 of 5).
                const offset = useSharedValue(2 * PAGE_WIDTH);
                const index = signal(2);
                return () => (
                    <Col gap={16} align="center" class="w-72">
                        <SwiperIndicator variant="dots" offset={offset} pageWidth={PAGE_WIDTH} count={COUNT} index={index} />
                        <SwiperIndicator variant="pill" offset={offset} pageWidth={PAGE_WIDTH} count={COUNT} index={index} />
                        <SwiperIndicator variant="scale-pulse" offset={offset} pageWidth={PAGE_WIDTH} count={COUNT} index={index} />
                        <SwiperIndicator variant="bar" offset={offset} pageWidth={PAGE_WIDTH} count={COUNT} index={index} />
                        <SwiperIndicator variant="numbered" count={COUNT} index={index} />
                    </Col>
                );
            }),
        },
        {
            title: 'Sizes',
            note: 'xs / sm / md / lg dot ramp',
            Demo: component(() => {
                const offset = useSharedValue(2 * PAGE_WIDTH);
                const index = signal(2);
                return () => (
                    <Col gap={16} align="center" class="w-72">
                        <SwiperIndicator variant="dots" size="xs" offset={offset} pageWidth={PAGE_WIDTH} count={COUNT} index={index} />
                        <SwiperIndicator variant="dots" size="sm" offset={offset} pageWidth={PAGE_WIDTH} count={COUNT} index={index} />
                        <SwiperIndicator variant="dots" size="md" offset={offset} pageWidth={PAGE_WIDTH} count={COUNT} index={index} />
                        <SwiperIndicator variant="dots" size="lg" offset={offset} pageWidth={PAGE_WIDTH} count={COUNT} index={index} />
                    </Col>
                );
            }),
        },
        {
            title: 'Live index',
            note: 'prev / next glide the offset like a real Swiper would',
            Demo: component(() => {
                const offset = useSharedValue(0);
                const index = signal(0);

                // Hoisted once in setup — wrapping per call would allocate a
                // new MT runner on every prev/next/dot press.
                const glideOffsetTo = runOnMainThread((to: number) => {
                    'main thread';
                    withTiming(offset, to, { duration: 0.28 });
                });
                const glideTo = (i: number) => {
                    glideOffsetTo(i * PAGE_WIDTH);
                };
                const go = (delta: number) => {
                    const next = Math.max(0, Math.min(COUNT - 1, index.value + delta));
                    if (next === index.value) return;
                    index.value = next;
                    glideTo(next);
                };

                return () => (
                    <Col gap={16} align="center" class="w-72">
                        <SwiperIndicator
                            variant="dots"
                            offset={offset}
                            pageWidth={PAGE_WIDTH}
                            count={COUNT}
                            index={index}
                            onDotPress={(i) => { index.value = i; glideTo(i); }}
                        />
                        <Row gap={12} align="center">
                            <Button variant="primary" size="sm" outline onPress={() => go(-1)}>Prev</Button>
                            <Text class="opacity-60">page {index.value + 1} / {COUNT}</Text>
                            <Button variant="primary" size="sm" outline onPress={() => go(1)}>Next</Button>
                        </Row>
                    </Col>
                );
            }),
        },
    ],
};
