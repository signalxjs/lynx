import { component } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, Heading, Row, ScrollView, Text } from '@sigx/lynx-daisyui';
import { setStatusBarStyle, setSystemBarsStyle } from '@sigx/lynx-appearance';

/**
 * System bars — drives @sigx/lynx-appearance's raw status/navigation-bar
 * APIs directly, bypassing StatusBarSync. Use this to verify the native
 * bridge independent of theme logic. (Theme-driven bar styling is shown by
 * StatusBarSync in App.tsx and the Theming screen.)
 */
export const SystemBars = component(() => {
    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="System bars" />
            <Col gap={16} padding={16}>
                <Heading level={2}>System bars</Heading>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Raw API</Text>
                            <Text class="opacity-60 text-sm">
                                Bypasses StatusBarSync to call
                                @sigx/lynx-appearance directly — use this to
                                verify the native bridge independent of theme
                                logic. Pop back (or switch theme) to let
                                StatusBarSync take over again.
                            </Text>
                            <Row gap={8} wrap>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    outline
                                    onPress={() => { void setStatusBarStyle('light'); }}
                                >
                                    Status: light
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    outline
                                    onPress={() => { void setStatusBarStyle('dark'); }}
                                >
                                    Status: dark
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    outline
                                    onPress={() => {
                                        void setSystemBarsStyle({
                                            statusBar: 'dark',
                                            navigationBar: { style: 'dark', color: '#ffffff' },
                                        });
                                    }}
                                >
                                    All bars: dark + white bg
                                </Button>
                            </Row>
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
