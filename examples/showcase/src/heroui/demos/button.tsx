import { component, signal } from '@sigx/lynx';
import { Button, Col, Row, Text } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

/**
 * Button — the shared contract's `color`/`variant` split with upstream
 * HeroUI's fill styles (solid / bordered / flat / ghost) and sm–lg size ramp.
 *
 * Exemplar for the hero demo-module shape: export one `HeroComponentDemo`;
 * each section's `Demo` is its own `component(...)` so interactive sections
 * own their signals.
 */
export const buttonDemo: HeroComponentDemo = {
    id: 'button',
    title: 'Button',
    description: 'Semantic colors, solid/bordered/flat/ghost fills, size ramp, states',
    icon: { set: 'lucide', name: 'mouse-pointer-click' },
    sections: [
        {
            title: 'Colors',
            note: 'Semantic `color` from the shared contract — same prop as daisy',
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
                </Row>
            )),
        },
        {
            title: 'Variants',
            note: 'Hero-specific fills — upstream HeroUI’s solid / bordered / flat / ghost',
            Demo: component(() => () => (
                <Row gap={8} class="flex-wrap">
                    <Button color="primary">Solid</Button>
                    <Button color="primary" variant="bordered">Bordered</Button>
                    <Button color="primary" variant="flat">Flat</Button>
                    <Button color="primary" variant="ghost">Ghost</Button>
                </Row>
            )),
        },
        {
            title: 'Sizes',
            note: 'Hero’s ramp is the sm–lg subset of the shared SizeScale',
            Demo: component(() => () => (
                <Row gap={8} align="center" class="flex-wrap">
                    <Button color="primary" size="sm">sm</Button>
                    <Button color="primary" size="md">md</Button>
                    <Button color="primary" size="lg">lg</Button>
                </Row>
            )),
        },
        {
            title: 'States',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Row gap={8} class="flex-wrap">
                        <Button color="primary" loading>Loading</Button>
                        <Button color="primary" disabled>Disabled</Button>
                    </Row>
                    <Button color="primary" block>Block</Button>
                </Col>
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
