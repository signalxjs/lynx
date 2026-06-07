import { component } from '@sigx/lynx';
import { Steps, Text } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

/** Steps — indicator circles; color marks completed/active. */
export const stepsDemo: HeroComponentDemo = {
    id: 'steps',
    title: 'Steps',
    description: 'Indicator sequence — color marks completed/active',
    icon: { set: 'lucide', name: 'list-ordered' },
    sections: [
        {
            title: 'Horizontal',
            Demo: component(() => () => (
                <Steps>
                    <Steps.Step color="primary" content="1" />
                    <Steps.Step color="primary" content="2" />
                    <Steps.Step content="3" />
                    <Steps.Step content="4" />
                </Steps>
            )),
        },
        {
            title: 'Vertical',
            Demo: component(() => () => (
                <Steps vertical>
                    <Steps.Step color="success" content="✓"><Text size="sm">Account</Text></Steps.Step>
                    <Steps.Step color="primary" content="2"><Text size="sm">Profile</Text></Steps.Step>
                    <Steps.Step content="3"><Text size="sm">Done</Text></Steps.Step>
                </Steps>
            )),
        },
    ],
};
