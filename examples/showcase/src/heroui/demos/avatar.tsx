import { component } from '@sigx/lynx';
import { Avatar, Row } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

const SRC = 'https://i.pravatar.cc/96';

/** Avatar — image or initials, size ramp, rounded/circle. */
export const avatarDemo: HeroComponentDemo = {
    id: 'avatar',
    title: 'Avatar',
    description: 'Image or initials, size ramp, rounded/circle',
    icon: { set: 'lucide', name: 'circle-user' },
    sections: [
        {
            title: 'Sizes (circle)',
            Demo: component(() => () => (
                <Row gap={12} align="center">
                    <Avatar src={SRC} size="xs" rounded="full" />
                    <Avatar src={SRC} size="sm" rounded="full" />
                    <Avatar src={SRC} size="md" rounded="full" />
                    <Avatar src={SRC} size="lg" rounded="full" />
                </Row>
            )),
        },
        {
            title: 'Initials placeholder',
            Demo: component(() => () => (
                <Row gap={12} align="center">
                    <Avatar placeholder="AE" size="md" />
                    <Avatar placeholder="JD" size="md" rounded="full" />
                    <Avatar placeholder="SX" size="lg" />
                </Row>
            )),
        },
    ],
};
