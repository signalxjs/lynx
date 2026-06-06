import { component } from '@sigx/lynx';
import { Alert, Col, Row, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Alert — the four semantic variants, a default (no-variant) alert and a
 * richer composition with an icon and trailing content.
 *
 * Alert is a static container; it has no interactive state.
 */
export const alertDemo: DaisyComponentDemo = {
    id: 'alert',
    title: 'Alert',
    description: 'Info / success / warning / error variants and default style',
    icon: { set: 'lucide', name: 'triangle-alert' },
    sections: [
        {
            title: 'Variants',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Alert color="info"><Text>A new update is available.</Text></Alert>
                    <Alert color="success"><Text>Your changes were saved.</Text></Alert>
                    <Alert color="warning"><Text>Storage is almost full.</Text></Alert>
                    <Alert color="error"><Text>Failed to reach the server.</Text></Alert>
                </Col>
            )),
        },
        {
            title: 'Default',
            note: 'no variant — neutral surface',
            Demo: component(() => () => (
                <Alert><Text>Twelve unread messages in your inbox.</Text></Alert>
            )),
        },
        {
            title: 'With trailing content',
            note: 'alerts can lay out a row of children',
            Demo: component(() => () => (
                <Alert color="warning">
                    <Row gap={12} align="center" class="justify-between">
                        <Text>Your trial ends in 3 days.</Text>
                        <Text class="font-semibold">Upgrade</Text>
                    </Row>
                </Alert>
            )),
        },
    ],
};
