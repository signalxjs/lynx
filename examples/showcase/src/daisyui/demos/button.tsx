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
                    <Button variant="primary">Primary</Button>
                    <Button variant="secondary">Secondary</Button>
                    <Button variant="accent">Accent</Button>
                    <Button variant="neutral">Neutral</Button>
                    <Button variant="info">Info</Button>
                    <Button variant="success">Success</Button>
                    <Button variant="warning">Warning</Button>
                    <Button variant="error">Error</Button>
                    <Button variant="ghost">Ghost</Button>
                    <Button variant="link">Link</Button>
                </Row>
            )),
        },
        {
            title: 'Sizes',
            Demo: component(() => () => (
                <Row gap={8} align="center" class="flex-wrap">
                    <Button variant="primary" size="xs">xs</Button>
                    <Button variant="primary" size="sm">sm</Button>
                    <Button variant="primary" size="md">md</Button>
                    <Button variant="primary" size="lg">lg</Button>
                    <Button variant="primary" size="xl">xl</Button>
                </Row>
            )),
        },
        {
            title: 'Styles',
            note: 'outline / soft / wide / block modifiers',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Row gap={8} class="flex-wrap">
                        <Button variant="primary" outline>Outline</Button>
                        <Button variant="primary" soft>Soft</Button>
                        <Button variant="primary" wide>Wide</Button>
                    </Row>
                    <Button variant="primary" block>Block</Button>
                </Col>
            )),
        },
        {
            title: 'States',
            Demo: component(() => () => (
                <Row gap={8} class="flex-wrap">
                    <Button variant="primary" loading>Loading</Button>
                    <Button variant="primary" disabled>Disabled</Button>
                    <Button variant="primary" active>Active</Button>
                </Row>
            )),
        },
        {
            title: 'Press events',
            Demo: component(() => {
                const count = signal(0);
                return () => (
                    <Row gap={12} align="center">
                        <Button variant="primary" onPress={() => { count.value = count.value + 1; }}>
                            Tap me
                        </Button>
                        <Text class="opacity-60">pressed {count.value}×</Text>
                    </Row>
                );
            }),
        },
    ],
};
