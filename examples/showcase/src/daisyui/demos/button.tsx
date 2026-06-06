import { component, signal } from '@sigx/lynx';
import { Button, Col, Row, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Button — every variant, the size ramp, style modifiers and the
 * loading/disabled states, plus a live press counter.
 *
 * Exemplar for the demo-module shape: export one `DaisyComponentDemo`;
 * each section's `Demo` is its own `component(...)` so interactive sections
 * own their signals.
 */
export const buttonDemo: DaisyComponentDemo = {
    id: 'button',
    title: 'Button',
    description: 'Variants, size ramp, outline/soft, loading & disabled states',
    icon: { set: 'lucide', name: 'mouse-pointer-click' },
    sections: [
        {
            title: 'Variants',
            Demo: component(() => () => (
                <Row gap={8} class="flex-wrap">
                    <Button color="primary">Primary</Button>
                    <Button color="secondary">Secondary</Button>
                    <Button color="accent">Accent</Button>
                    <Button color="neutral">Neutral</Button>
                    <Button color="info">Info</Button>
                    <Button color="success">Success</Button>
                    <Button color="warning">Warning</Button>
                    <Button color="error">Error</Button>
                    <Button variant="ghost">Ghost</Button>
                    <Button variant="link">Link</Button>
                </Row>
            )),
        },
        {
            title: 'Sizes',
            Demo: component(() => () => (
                <Row gap={8} align="center" class="flex-wrap">
                    <Button color="primary" size="xs">xs</Button>
                    <Button color="primary" size="sm">sm</Button>
                    <Button color="primary" size="md">md</Button>
                    <Button color="primary" size="lg">lg</Button>
                    <Button color="primary" size="xl">xl</Button>
                </Row>
            )),
        },
        {
            title: 'Styles',
            note: 'outline / soft / wide / block modifiers',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Row gap={8} class="flex-wrap">
                        <Button color="primary" variant="outline">Outline</Button>
                        <Button color="primary" variant="soft">Soft</Button>
                        <Button color="primary" wide>Wide</Button>
                    </Row>
                    <Button color="primary" block>Block</Button>
                </Col>
            )),
        },
        {
            title: 'States',
            Demo: component(() => () => (
                <Row gap={8} class="flex-wrap">
                    <Button color="primary" loading>Loading</Button>
                    <Button color="primary" disabled>Disabled</Button>
                    <Button color="primary" active>Active</Button>
                </Row>
            )),
        },
        {
            title: 'Press events',
            Demo: component(() => {
                const count = signal(0);
                return () => (
                    <Row gap={12} align="center">
                        <Button color="primary" onPress={() => { count.value = count.value + 1; }}>
                            Tap me
                        </Button>
                        <Text class="opacity-60">pressed {count.value}×</Text>
                    </Row>
                );
            }),
        },
    ],
};
