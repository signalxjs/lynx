import { component, signal } from '@sigx/lynx';
import { Col, Rating, Row, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Rating — tap-to-set star input: the color ramp, the size ramp, a read-only
 * display, a custom `max`, and a live `model`-bound row echoing its value.
 */
export const ratingDemo: DaisyComponentDemo = {
    id: 'rating',
    title: 'Rating',
    description: 'Tap-to-set stars, color & size ramps, read-only, custom max, live two-way model binding',
    icon: { set: 'lucide', name: 'star' },
    sections: [
        {
            title: 'Model binding',
            Demo: component(() => {
                const stars = signal(3);
                return () => (
                    <Col gap={8}>
                        <Rating model={() => stars.value} />
                        <Text class="opacity-60">value: {stars.value}</Text>
                    </Col>
                );
            }),
        },
        {
            title: 'Colors',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Rating value={4} color="primary" />
                    <Rating value={4} color="secondary" />
                    <Rating value={4} color="accent" />
                    <Rating value={4} color="warning" />
                    <Rating value={4} color="error" />
                </Col>
            )),
        },
        {
            title: 'Sizes',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Rating value={3} size="xs" />
                    <Rating value={3} size="sm" />
                    <Rating value={3} size="md" />
                    <Rating value={3} size="lg" />
                </Col>
            )),
        },
        {
            title: 'Read-only',
            note: 'display mode — taps are ignored',
            Demo: component(() => () => (
                <Rating value={4} readOnly color="warning" />
            )),
        },
        {
            title: 'Custom max',
            Demo: component(() => {
                const score = signal(7);
                return () => (
                    <Col gap={8}>
                        <Rating model={() => score.value} max={10} color="primary" size="sm" />
                        <Text class="opacity-60">value: {score.value} / 10</Text>
                    </Col>
                );
            }),
        },
    ],
};
