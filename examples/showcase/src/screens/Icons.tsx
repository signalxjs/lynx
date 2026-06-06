import { component } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Card, Col, Heading, Row, ScrollView, Text } from '@sigx/lynx-daisyui';
import { FaBrandIcon, FaSolidIcon } from '@sigx/lynx-icons-fa-free/components';
import { LucideIcon } from '@sigx/lynx-icons-lucide/components';

/**
 * Icons — @sigx/lynx-icons adapters (Font Awesome free + Lucide) with
 * daisy-variant theming, plus the runtime-resolved dynamic-name path that
 * relies on `include: ['*']` in signalx.config.ts.
 */
export const Icons = component(() => {
    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Icons" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Icons</Heading>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">@sigx/lynx-icons</Text>
                            <Text class="opacity-60 text-sm">
                                Pinned per-set components from each adapter
                                (`FaSolidIcon`, `FaBrandIcon`, `LucideIcon`)
                                themed via daisy variants — the color
                                resolver provided by `ThemeProvider` maps
                                `variant` to the active theme's hex.
                            </Text>
                            <Row gap={16} align="center">
                                <FaSolidIcon name="user" size={24} variant="primary" />
                                <FaSolidIcon name="house" size={24} variant="secondary" />
                                <FaSolidIcon name="gear" size={24} variant="accent" />
                                <FaBrandIcon name="github" size={24} variant="neutral" />
                                <LucideIcon name="search" size={24} variant="info" />
                                <LucideIcon name="bell" size={24} variant="warning" />
                            </Row>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Dynamic icon names</Text>
                            <Text class="opacity-60 text-sm">
                                Names come from a JS array — the JSX scanner can't
                                see them. With `include: ['*']` on the `fas` set in
                                signalx.config.ts, the full FA solid catalog is
                                bundled and these resolve at runtime.
                            </Text>
                            <Row gap={16} align="center">
                                {['rocket', 'bug', 'fire', 'star', 'heart'].map((name) => (
                                    <FaSolidIcon name={name} size={24} variant="primary" />
                                ))}
                            </Row>
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
