import { component, signal } from '@sigx/lynx';
import { Col, Row, Toggle, Text } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

/** Toggle — pill switch; semantic color when on, sm/md/lg sizes. */
export const toggleDemo: HeroComponentDemo = {
    id: 'toggle',
    title: 'Toggle',
    description: 'Pill switch — semantic color when on, size ramp',
    icon: { set: 'lucide', name: 'toggle-left' },
    sections: [
        {
            title: 'Interactive',
            Demo: component(() => {
                const on = signal(true);
                return () => (
                    <Row gap={12} align="center">
                        <Toggle checked={on.value} onChange={(v) => { on.value = v; }} />
                        <Text size="sm" class="opacity-60">{on.value ? 'on' : 'off'}</Text>
                    </Row>
                );
            }),
        },
        {
            title: 'Colors',
            Demo: component(() => () => (
                <Row gap={12} align="center" class="flex-wrap">
                    <Toggle checked color="primary" />
                    <Toggle checked color="success" />
                    <Toggle checked color="warning" />
                    <Toggle checked color="error" />
                </Row>
            )),
        },
        {
            title: 'Sizes & disabled',
            Demo: component(() => () => (
                <Row gap={12} align="center">
                    <Toggle checked size="sm" />
                    <Toggle checked size="md" />
                    <Toggle checked size="lg" />
                    <Toggle checked disabled />
                </Row>
            )),
        },
    ],
};
