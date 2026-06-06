import { component, signal } from '@sigx/lynx';
import { Checkbox, Col, Row, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Checkbox — the color ramp, the size ramp, checked/disabled states and a
 * live `onChange`-bound box echoing its value.
 */
export const checkboxDemo: DaisyComponentDemo = {
    id: 'checkbox',
    title: 'Checkbox',
    description: 'Color & size ramps, checked & disabled states, live onChange binding',
    icon: { set: 'lucide', name: 'square-check' },
    sections: [
        {
            title: 'Colors',
            Demo: component(() => () => (
                <Row gap={12} align="center" class="flex-wrap">
                    <Checkbox checked color="primary" />
                    <Checkbox checked color="secondary" />
                    <Checkbox checked color="accent" />
                    <Checkbox checked color="info" />
                    <Checkbox checked color="success" />
                    <Checkbox checked color="warning" />
                    <Checkbox checked color="error" />
                </Row>
            )),
        },
        {
            title: 'Sizes',
            Demo: component(() => () => (
                <Row gap={12} align="center" class="flex-wrap">
                    <Checkbox checked color="primary" size="xs" />
                    <Checkbox checked color="primary" size="sm" />
                    <Checkbox checked color="primary" size="md" />
                    <Checkbox checked color="primary" size="lg" />
                </Row>
            )),
        },
        {
            title: 'States',
            Demo: component(() => () => (
                <Row gap={12} align="center" class="flex-wrap">
                    <Checkbox checked color="primary" />
                    <Checkbox checked={false} color="primary" />
                    <Checkbox checked disabled color="primary" />
                    <Checkbox checked={false} disabled color="primary" />
                </Row>
            )),
        },
        {
            title: 'Change events',
            Demo: component(() => {
                const newsletter = signal(false);
                return () => (
                    <Row gap={12} align="center" justify="space-between">
                        <Text>Subscribe to newsletter</Text>
                        <Checkbox
                            color="primary"
                            checked={newsletter.value}
                            onChange={(checked) => { newsletter.value = checked; }}
                        />
                    </Row>
                );
            }),
        },
    ],
};
