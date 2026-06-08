import { component, signal } from '@sigx/lynx';
import { Button, Col, Row, SwiperIndicator, Text } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

/**
 * SwiperIndicator — the design-system-neutral page indicator (it lives in
 * @sigx/lynx-zero and both DSs re-export it). Colors come from the active
 * theme's tokens, so it renders in the hero palette inside a hero scope.
 * Five variants (dots / bar / pill / numbered / scale-pulse) and a size ramp;
 * with only `index` wired it derives the offset and glides on each change.
 */
const COUNT = 5;

export const swiperindicatorDemo: HeroComponentDemo = {
    id: 'swiperindicator',
    title: 'SwiperIndicator',
    description: 'Carousel page indicator — dots / bar / pill / numbered / scale-pulse, sizes',
    icon: { set: 'lucide', name: 'ellipsis' },
    sections: [
        {
            title: 'Variants',
            note: 'index-only mode — every variant animates from the same index signal',
            Demo: component(() => {
                const index = signal(2);
                return () => (
                    <Col gap={16} align="center">
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
                    <Col gap={16} align="center">
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
            note: 'prev / next just write the index — the indicator glides itself; tap a dot to jump',
            Demo: component(() => {
                const index = signal(0);
                const go = (delta: number) => {
                    index.value = Math.max(0, Math.min(COUNT - 1, index.value + delta));
                };
                return () => (
                    <Col gap={16} align="center">
                        <SwiperIndicator
                            variant="dots"
                            count={COUNT}
                            index={index}
                            onDotPress={(i) => { index.value = i; }}
                        />
                        <Row gap={12} align="center">
                            <Button color="primary" size="sm" variant="bordered" onPress={() => go(-1)}>Prev</Button>
                            <Text class="opacity-60">page {index.value + 1} / {COUNT}</Text>
                            <Button color="primary" size="sm" variant="bordered" onPress={() => go(1)}>Next</Button>
                        </Row>
                    </Col>
                );
            }),
        },
    ],
};
