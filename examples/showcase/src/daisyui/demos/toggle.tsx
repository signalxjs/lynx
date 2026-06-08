import { component, signal } from '@sigx/lynx';
import { Col, Row, Text, Toggle } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Toggle — the color ramp, the size ramp, checked/disabled states and a
 * live `model`-bound switch echoing its value.
 */
export const toggleDemo: DaisyComponentDemo = {
    id: 'toggle',
    title: 'Toggle',
    description: 'Color & size ramps, checked & disabled states, live two-way model binding',
    icon: { set: 'lucide', name: 'toggle-left' },
    sections: [
        {
            title: 'Colors',
            Demo: component(() => () => (
                <Row gap={12} align="center" class="flex-wrap">
                    <Toggle checked color="primary" />
                    <Toggle checked color="secondary" />
                    <Toggle checked color="accent" />
                    <Toggle checked color="info" />
                    <Toggle checked color="success" />
                    <Toggle checked color="warning" />
                    <Toggle checked color="error" />
                </Row>
            )),
        },
        {
            title: 'Sizes',
            Demo: component(() => () => (
                <Row gap={12} align="center" class="flex-wrap">
                    <Toggle checked color="primary" size="xs" />
                    <Toggle checked color="primary" size="sm" />
                    <Toggle checked color="primary" size="md" />
                    <Toggle checked color="primary" size="lg" />
                </Row>
            )),
        },
        {
            title: 'States',
            Demo: component(() => () => (
                <Row gap={12} align="center" class="flex-wrap">
                    <Toggle checked color="primary" />
                    <Toggle checked={false} color="primary" />
                    <Toggle checked disabled color="primary" />
                    <Toggle checked={false} disabled color="primary" />
                </Row>
            )),
        },
        {
            title: 'Two-way binding',
            Demo: component(() => {
                const darkPreview = signal(false);
                return () => (
                    <Col gap={8}>
                        <Row gap={12} align="center" justify="space-between">
                            <Text>Dark preview</Text>
                            <Toggle color="primary" model={() => darkPreview.value} />
                        </Row>
                        <Text class="opacity-60">dark: {darkPreview.value ? 'on' : 'off'}</Text>
                    </Col>
                );
            }),
        },
    ],
};
