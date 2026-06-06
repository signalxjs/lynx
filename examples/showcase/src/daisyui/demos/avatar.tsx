import { component } from '@sigx/lynx';
import { Avatar, Col, Row, Text, type AvatarSize } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Avatar — the size ramp (xs 24px … xl 96px), remote-image vs. initials
 * placeholder, the square/rounded shapes, and the online/offline presence dot.
 */

const SIZES: AvatarSize[] = ['xs', 'sm', 'md', 'lg', 'xl'];

// Stable remote placeholder portraits for the image variants.
const IMG = (n: number) => `https://i.pravatar.cc/150?img=${n}`;

export const avatarDemo: DaisyComponentDemo = {
    id: 'avatar',
    title: 'Avatar',
    description: 'Size ramp, image vs. initials, shapes and presence indicators',
    icon: { set: 'lucide', name: 'circle-user' },
    sections: [
        {
            title: 'Sizes',
            note: 'xs 24px · sm 32px · md 48px · lg 64px · xl 96px',
            Demo: component(() => () => (
                <Row gap={12} align="center" class="flex-wrap">
                    {SIZES.map((size, i) => (
                        <Avatar key={size} src={IMG(12 + i)} size={size} rounded="full" />
                    ))}
                </Row>
            )),
        },
        {
            title: 'Image vs. initials',
            note: 'falls back to a placeholder string when no src is set',
            Demo: component(() => () => (
                <Row gap={12} align="center" class="flex-wrap">
                    <Avatar src={IMG(5)} size="lg" rounded="full" />
                    <Avatar placeholder="AE" size="lg" rounded="full" />
                    <Avatar placeholder="JS" size="lg" rounded="full" />
                    <Avatar size="lg" rounded="full" />
                </Row>
            )),
        },
        {
            title: 'Shapes',
            note: 'rounded="full" for a circle, otherwise an 8px-rounded square',
            Demo: component(() => () => (
                <Row gap={16} align="center" class="flex-wrap">
                    <Col gap={6} align="center">
                        <Avatar src={IMG(8)} size="lg" rounded="full" />
                        <Text class="opacity-60 text-sm">full</Text>
                    </Col>
                    <Col gap={6} align="center">
                        <Avatar src={IMG(8)} size="lg" />
                        <Text class="opacity-60 text-sm">square</Text>
                    </Col>
                </Row>
            )),
        },
        {
            title: 'Presence',
            note: 'online / offline status dot',
            Demo: component(() => () => (
                <Row gap={16} align="center" class="flex-wrap">
                    <Col gap={6} align="center">
                        <Avatar src={IMG(20)} size="lg" rounded="full" online />
                        <Text class="opacity-60 text-sm">online</Text>
                    </Col>
                    <Col gap={6} align="center">
                        <Avatar src={IMG(21)} size="lg" rounded="full" offline />
                        <Text class="opacity-60 text-sm">offline</Text>
                    </Col>
                </Row>
            )),
        },
    ],
};
