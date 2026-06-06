import { component } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, Heading, Row, ScrollView, Text } from '@sigx/lynx-daisyui';
import { Haptics, type ImpactStyle, type NotificationType } from '@sigx/lynx-haptics';

/**
 * Haptics — every feedback primitive in @sigx/lynx-haptics. Needs a real
 * device; simulators don't vibrate.
 */
export const HapticsDemo = component(() => {
    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Haptics" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Haptics</Heading>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Impact</Text>
                            <Text class="opacity-60 text-sm">
                                Collision-style feedback in three intensities.
                            </Text>
                            <Row gap={8} wrap>
                                {(['light', 'medium', 'heavy'] as ImpactStyle[]).map((style) => (
                                    <Button
                                        key={style}
                                        size="sm"
                                        color="primary"
                                        variant="outline"
                                        onPress={() => Haptics.impact(style)}
                                    >
                                        {style}
                                    </Button>
                                ))}
                            </Row>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Notification</Text>
                            <Text class="opacity-60 text-sm">
                                Outcome-style feedback patterns.
                            </Text>
                            <Row gap={8} wrap>
                                {(['success', 'warning', 'error'] as NotificationType[]).map((type) => (
                                    <Button
                                        key={type}
                                        size="sm"
                                        color="secondary"
                                        variant="outline"
                                        onPress={() => Haptics.notification(type)}
                                    >
                                        {type}
                                    </Button>
                                ))}
                            </Row>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Selection</Text>
                            <Text class="opacity-60 text-sm">
                                The light tick for picker/segment changes.
                            </Text>
                            <Button size="sm" variant="outline" onPress={() => Haptics.selection()}>
                                selection()
                            </Button>
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
