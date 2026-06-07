import { component } from '@sigx/lynx';
import { Col, Divider, Text } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

/** Divider — plain hairline + labeled line·label·line. */
export const dividerDemo: HeroComponentDemo = {
    id: 'divider',
    title: 'Divider',
    description: 'Plain hairline or line · label · line',
    icon: { set: 'lucide', name: 'minus' },
    sections: [
        {
            title: 'Plain',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Text size="sm">Above</Text>
                    <Divider />
                    <Text size="sm">Below</Text>
                </Col>
            )),
        },
        {
            title: 'Labeled',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Text size="sm">Sign in with email</Text>
                    <Divider><Text size="sm" class="opacity-60">or</Text></Divider>
                    <Text size="sm">Continue with Google</Text>
                </Col>
            )),
        },
        {
            title: 'Vertical',
            Demo: component(() => () => (
                <view style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, height: 40 }}>
                    <Text size="sm">Left</Text>
                    <Divider vertical />
                    <Text size="sm">Right</Text>
                </view>
            )),
        },
    ],
};
