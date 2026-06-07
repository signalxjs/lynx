import { component } from '@sigx/lynx';
import { Alert, Col, Text } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

/** Alert — soft-tinted status surface. */
export const alertDemo: HeroComponentDemo = {
    id: 'alert',
    title: 'Alert',
    description: 'Soft-tinted status surface — info/success/warning/error',
    icon: { set: 'lucide', name: 'triangle-alert' },
    sections: [
        {
            title: 'Status colors',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Alert color="info"><Text size="sm">Heads up — something to note.</Text></Alert>
                    <Alert color="success"><Text size="sm">Saved successfully.</Text></Alert>
                    <Alert color="warning"><Text size="sm">Check your input.</Text></Alert>
                    <Alert color="error"><Text size="sm">Something went wrong.</Text></Alert>
                </Col>
            )),
        },
    ],
};
