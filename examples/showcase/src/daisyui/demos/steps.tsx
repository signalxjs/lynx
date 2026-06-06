import { component, signal } from '@sigx/lynx';
import { Button, Col, Row, Steps, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Steps — a horizontal progress trail, a vertical variant, per-step content
 * markers and a live walkthrough that advances the current step.
 *
 * The last section owns its `current` signal and recolours steps up to it.
 */
export const stepsDemo: DaisyComponentDemo = {
    id: 'steps',
    title: 'Steps',
    description: 'Horizontal / vertical trails, content markers and a live walkthrough',
    icon: { set: 'lucide', name: 'list-ordered' },
    sections: [
        {
            title: 'Horizontal',
            note: 'completed steps coloured up to the current one',
            Demo: component(() => () => (
                <Steps>
                    <Steps.Step color="primary"><Text>Register</Text></Steps.Step>
                    <Steps.Step color="primary"><Text>Choose plan</Text></Steps.Step>
                    <Steps.Step><Text>Purchase</Text></Steps.Step>
                    <Steps.Step><Text>Receive</Text></Steps.Step>
                </Steps>
            )),
        },
        {
            title: 'Vertical',
            Demo: component(() => () => (
                <Steps vertical>
                    <Steps.Step color="success"><Text>Order placed</Text></Steps.Step>
                    <Steps.Step color="success"><Text>Shipped</Text></Steps.Step>
                    <Steps.Step><Text>Out for delivery</Text></Steps.Step>
                    <Steps.Step><Text>Delivered</Text></Steps.Step>
                </Steps>
            )),
        },
        {
            title: 'Content markers',
            note: 'custom indicator content per step',
            Demo: component(() => () => (
                <Steps>
                    <Steps.Step color="accent" content="✓"><Text>Done</Text></Steps.Step>
                    <Steps.Step color="accent" content="?"><Text>Pending</Text></Steps.Step>
                    <Steps.Step content="✕"><Text>Skipped</Text></Steps.Step>
                </Steps>
            )),
        },
        {
            title: 'Live walkthrough',
            Demo: component(() => {
                const steps = ['Register', 'Choose plan', 'Purchase', 'Receive'];
                const current = signal(1);
                return () => (
                    <Col gap={12}>
                        <Steps>
                            {steps.map((label, i) => (
                                <Steps.Step key={label} color={i <= current.value ? 'primary' : undefined}>
                                    <Text>{label}</Text>
                                </Steps.Step>
                            ))}
                        </Steps>
                        <Row gap={12} align="center">
                            <Button
                                color="neutral"
                                size="sm"
                                onPress={() => { current.value = Math.max(current.value - 1, 0); }}
                            >
                                Back
                            </Button>
                            <Button
                                color="primary"
                                size="sm"
                                onPress={() => { current.value = Math.min(current.value + 1, steps.length - 1); }}
                            >
                                Next
                            </Button>
                            <Text class="opacity-60">step {current.value + 1} of {steps.length}</Text>
                        </Row>
                    </Col>
                );
            }),
        },
    ],
};
