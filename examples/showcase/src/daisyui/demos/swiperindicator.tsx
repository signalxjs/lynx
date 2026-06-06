import { component, signal } from '@sigx/lynx';
import { Button, Col, Row, SwiperIndicator, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * SwiperIndicator — themed page indicator for a `<Swiper>` carousel, with five
 * preset variants (`dots`, `bar`, `pill`, `numbered`, `scale-pulse`) and a size
 * ramp (`xs` … `lg`).
 *
 * Wired to a real `<Swiper>` the animated variants read its live MT `offset`
 * (+ `pageWidth`) for scroll-linked fidelity. With only `index` wired — as on
 * this page, where there is no Swiper — the indicator derives the offset
 * internally (#211) and glides between page positions on every index change.
 */

const COUNT = 5;

export const swiperindicatorDemo: DaisyComponentDemo = {
    id: 'swiperindicator',
    title: 'SwiperIndicator',
    description: 'Carousel page indicator — dots / bar / pill / numbered / scale-pulse variants & sizes',
    icon: { set: 'lucide', name: 'ellipsis' },
    sections: [
        {
            title: 'Variants',
            note: 'index-only mode — every variant animates from the same index signal',
            Demo: component(() => {
                const index = signal(2);
                return () => (
                    <Col gap={16} align="center" class="w-72">
                        <SwiperIndicator variant="dots" count={COUNT} index={index} />
                        <SwiperIndicator variant="pill" count={COUNT} index={index} />
                        <SwiperIndicator variant="scale-pulse" count={COUNT} index={index} />
                        <SwiperIndicator variant="bar" count={COUNT} index={index} />
                        <SwiperIndicator variant="numbered" count={COUNT} index={index} />
                    </Col>
                );
            }),
        },
        {
            title: 'Sizes',
            note: 'xs / sm / md / lg dot ramp',
            Demo: component(() => {
                const index = signal(2);
                return () => (
                    <Col gap={16} align="center" class="w-72">
                        <SwiperIndicator variant="dots" size="xs" count={COUNT} index={index} />
                        <SwiperIndicator variant="dots" size="sm" count={COUNT} index={index} />
                        <SwiperIndicator variant="dots" size="md" count={COUNT} index={index} />
                        <SwiperIndicator variant="dots" size="lg" count={COUNT} index={index} />
                    </Col>
                );
            }),
        },
        {
            title: 'Live index',
            note: 'prev / next just write the index — the indicator glides itself',
            Demo: component(() => {
                const index = signal(0);
                const go = (delta: number) => {
                    index.value = Math.max(0, Math.min(COUNT - 1, index.value + delta));
                };
                return () => (
                    <Col gap={16} align="center" class="w-72">
                        <SwiperIndicator
                            variant="dots"
                            count={COUNT}
                            index={index}
                            onDotPress={(i) => { index.value = i; }}
                        />
                        <Row gap={12} align="center">
                            <Button color="primary" size="sm" variant="outline" onPress={() => go(-1)}>Prev</Button>
                            <Text class="opacity-60">page {index.value + 1} / {COUNT}</Text>
                            <Button color="primary" size="sm" variant="outline" onPress={() => go(1)}>Next</Button>
                        </Row>
                    </Col>
                );
            }),
        },
    ],
};
