import { component, signal } from '@sigx/lynx';
import { Checkbox, Row, Text } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

/** Checkbox — rounded box + checkmark; semantic color, size ramp. */
export const checkboxDemo: HeroComponentDemo = {
    id: 'checkbox',
    title: 'Checkbox',
    description: 'Rounded box + checkmark — semantic color, size ramp',
    icon: { set: 'lucide', name: 'square-check' },
    sections: [
        {
            title: 'Interactive',
            Demo: component(() => {
                const checked = signal(true);
                return () => (
                    <Row gap={12} align="center">
                        <Checkbox checked={checked.value} onChange={(v) => { checked.value = v; }} />
                        <Text size="sm" class="opacity-60">{checked.value ? 'checked' : 'unchecked'}</Text>
                    </Row>
                );
            }),
        },
        {
            title: 'Colors',
            Demo: component(() => () => (
                <Row gap={12} align="center" class="flex-wrap">
                    <Checkbox checked color="primary" />
                    <Checkbox checked color="success" />
                    <Checkbox checked color="warning" />
                    <Checkbox checked color="error" />
                </Row>
            )),
        },
        {
            title: 'Sizes & disabled',
            Demo: component(() => () => (
                <Row gap={12} align="center">
                    <Checkbox checked size="sm" />
                    <Checkbox checked size="md" />
                    <Checkbox checked size="lg" />
                    <Checkbox checked disabled />
                    <Checkbox checked={false} />
                </Row>
            )),
        },
    ],
};
