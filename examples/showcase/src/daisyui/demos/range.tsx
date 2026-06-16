import { component, signal } from '@sigx/lynx';
import { Col, Range, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Range — drag slider: a live `model`-bound value, the color ramp, the size
 * ramp, custom min/max/step, and a disabled state.
 */
export const rangeDemo: DaisyComponentDemo = {
    id: 'range',
    title: 'Range',
    description: 'Drag slider — color & size ramps, min/max/step, disabled, live two-way model binding',
    icon: { set: 'lucide', name: 'sliders-horizontal' },
    sections: [
        {
            title: 'Model binding',
            Demo: component(() => {
                const volume = signal(40);
                return () => (
                    <Col gap={12}>
                        <Range model={() => volume.value} />
                        <Text class="opacity-60">value: {volume.value}</Text>
                    </Col>
                );
            }),
        },
        {
            title: 'Colors',
            Demo: component(() => () => (
                <Col gap={16}>
                    <Range value={60} color="primary" />
                    <Range value={60} color="secondary" />
                    <Range value={60} color="accent" />
                    <Range value={60} color="success" />
                    <Range value={60} color="error" />
                </Col>
            )),
        },
        {
            title: 'Sizes',
            Demo: component(() => () => (
                <Col gap={16}>
                    <Range value={50} size="xs" />
                    <Range value={50} size="sm" />
                    <Range value={50} size="md" />
                    <Range value={50} size="lg" />
                </Col>
            )),
        },
        {
            title: 'Steps',
            note: 'min 0, max 10, step 1',
            Demo: component(() => {
                const rating = signal(7);
                return () => (
                    <Col gap={12}>
                        <Range model={() => rating.value} min={0} max={10} step={1} color="accent" />
                        <Text class="opacity-60">value: {rating.value} / 10</Text>
                    </Col>
                );
            }),
        },
        {
            title: 'Disabled',
            Demo: component(() => () => (
                <Range value={30} disabled />
            )),
        },
    ],
};
