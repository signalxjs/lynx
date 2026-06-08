import { component, signal } from '@sigx/lynx';
import { Col, Radio, Row, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Radio — a grouped `Radio` with `Radio.Item`s: the color ramp, the size
 * ramp, the disabled state and a live `model`-bound group echoing its value.
 */
export const radioDemo: DaisyComponentDemo = {
    id: 'radio',
    title: 'Radio',
    description: 'Grouped Radio.Item color & size ramps, disabled state, live two-way model binding',
    icon: { set: 'lucide', name: 'circle-dot' },
    sections: [
        {
            title: 'Colors',
            Demo: component(() => () => (
                <Row gap={16} align="center" class="flex-wrap">
                    <Radio.Item value="a" checked color="primary" />
                    <Radio.Item value="b" checked color="secondary" />
                    <Radio.Item value="c" checked color="accent" />
                    <Radio.Item value="d" checked color="success" />
                    <Radio.Item value="e" checked color="error" />
                </Row>
            )),
        },
        {
            title: 'Sizes',
            Demo: component(() => () => (
                <Row gap={16} align="center" class="flex-wrap">
                    <Radio.Item value="xs" checked color="primary" size="xs" />
                    <Radio.Item value="sm" checked color="primary" size="sm" />
                    <Radio.Item value="md" checked color="primary" size="md" />
                    <Radio.Item value="lg" checked color="primary" size="lg" />
                </Row>
            )),
        },
        {
            title: 'States',
            Demo: component(() => () => (
                <Row gap={16} align="center" class="flex-wrap">
                    <Radio.Item value="on" label="Checked" checked color="primary" />
                    <Radio.Item value="off" label="Unchecked" checked={false} color="primary" />
                    <Radio.Item value="dis" label="Disabled" checked disabled color="primary" />
                </Row>
            )),
        },
        {
            title: 'Two-way binding',
            Demo: component(() => {
                const plan = signal('free');
                return () => (
                    <Col gap={8}>
                        <Radio>
                            {(['free', 'pro', 'team'] as const).map((value) => (
                                <Radio.Item
                                    key={value}
                                    value={value}
                                    label={value}
                                    color="primary"
                                    model={() => plan.value}
                                />
                            ))}
                        </Radio>
                        <Text class="opacity-60">plan: {plan.value}</Text>
                    </Col>
                );
            }),
        },
    ],
};
