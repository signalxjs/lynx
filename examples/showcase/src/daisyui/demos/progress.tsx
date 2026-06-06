import { component, signal } from '@sigx/lynx';
import { Button, Col, Progress, Row, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Progress — fixed fill levels, the semantic colours, a custom max scale and
 * a live bar driven by +/- buttons.
 *
 * Only the last section is interactive; it owns its `value` signal.
 */
export const progressDemo: DaisyComponentDemo = {
    id: 'progress',
    title: 'Progress',
    description: 'Fill levels, semantic colours, custom max and a live value',
    icon: { set: 'lucide', name: 'gauge' },
    sections: [
        {
            title: 'Levels',
            note: 'value out of the default max of 100',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Progress value={20} />
                    <Progress value={50} />
                    <Progress value={80} />
                    <Progress value={100} />
                </Col>
            )),
        },
        {
            title: 'Colours',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Progress value={60} color="primary" />
                    <Progress value={60} color="secondary" />
                    <Progress value={60} color="accent" />
                    <Progress value={60} color="info" />
                    <Progress value={60} color="success" />
                    <Progress value={60} color="warning" />
                    <Progress value={60} color="error" />
                </Col>
            )),
        },
        {
            title: 'Custom max',
            note: 'value 3 of max 5',
            Demo: component(() => () => (
                <Progress value={3} max={5} color="success" />
            )),
        },
        {
            title: 'Live value',
            Demo: component(() => {
                const value = signal(40);
                const clamp = (n: number) => Math.min(Math.max(n, 0), 100);
                return () => (
                    <Col gap={12}>
                        <Progress value={value.value} color="primary" />
                        <Row gap={12} align="center">
                            <Button variant="neutral" size="sm" onPress={() => { value.value = clamp(value.value - 10); }}>
                                −10
                            </Button>
                            <Button variant="primary" size="sm" onPress={() => { value.value = clamp(value.value + 10); }}>
                                +10
                            </Button>
                            <Text class="opacity-60">{value.value}%</Text>
                        </Row>
                    </Col>
                );
            }),
        },
    ],
};
