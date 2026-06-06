import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import {
    Card, Col, Divider, Heading, Row, ScrollView, Text,
    Button as DaisyButton,
    ThemeProvider,
} from '@sigx/lynx-daisyui';
import {
    Button as HeroButton,
    Card as HeroCard,
    Heading as HeroHeading,
    Input as HeroInput,
    Modal as HeroModal,
    Tabs as HeroTabs,
    Text as HeroText,
} from '@sigx/lynx-heroui';

/**
 * HeroUI Lab — the on-device A/B for the design-system layering epic (#219).
 *
 * The screen runs inside the app's daisy theme; the hero section below mounts
 * a *nested* `<ThemeProvider initial="hero-light">` so the same engine
 * recolors that subtree from the hero palette while the rest of the app stays
 * daisy. Both component sets follow the shared lynx-zero contract, so the
 * usage code is near-identical — compare the two Button rows.
 */
export const HeroUILab = component(() => {
    const state = signal({ tab: 'photos', modalOpen: false });
    const name = signal('');

    const heroButtons = () => (
        <Col gap={8}>
            <Row gap={8}>
                <HeroButton color="primary" size="sm" onPress={() => {}}>Primary</HeroButton>
                <HeroButton color="secondary" size="sm">Secondary</HeroButton>
                <HeroButton color="error" size="sm">Danger</HeroButton>
            </Row>
            <Row gap={8}>
                <HeroButton color="primary" size="sm" variant="bordered">Bordered</HeroButton>
                <HeroButton color="primary" size="sm" variant="flat">Flat</HeroButton>
                <HeroButton color="primary" size="sm" variant="ghost">Ghost</HeroButton>
            </Row>
        </Col>
    );

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="HeroUI Lab" />
            <Col gap={16} padding={16}>
                <Heading level={2}>HeroUI Lab</Heading>
                <Text class="opacity-60 text-sm">
                    Two design systems, one foundation: the section below nests a
                    ThemeProvider on the hero palette. The Button usage is the
                    same shape in both — semantic `color`, DS-specific `variant`.
                </Text>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">daisyUI (app theme)</Text>
                            <Row gap={8}>
                                <DaisyButton color="primary" size="sm" onPress={() => {}}>Primary</DaisyButton>
                                <DaisyButton color="secondary" size="sm">Secondary</DaisyButton>
                                <DaisyButton color="primary" size="sm" variant="outline">Outline</DaisyButton>
                            </Row>
                        </Col>
                    </Card.Body>
                </Card>

                <Divider>nested hero-light scope</Divider>

                <ThemeProvider initial="hero-light" style={{ borderRadius: 14, overflow: 'hidden' }}>
                    <Col gap={12} padding={16}>
                        <HeroHeading level={3}>HeroUI pilot</HeroHeading>

                        {heroButtons()}

                        <HeroTabs>
                            <HeroTabs.Tab
                                value="photos"
                                label="Photos"
                                active={state.tab === 'photos'}
                                onPress={() => { state.tab = 'photos'; }}
                            />
                            <HeroTabs.Tab
                                value="music"
                                label="Music"
                                active={state.tab === 'music'}
                                onPress={() => { state.tab = 'music'; }}
                            />
                            <HeroTabs.Tab
                                value="videos"
                                label="Videos"
                                active={state.tab === 'videos'}
                                onPress={() => { state.tab = 'videos'; }}
                            />
                        </HeroTabs>
                        <HeroText size="sm">active tab: {state.tab}</HeroText>

                        <HeroCard>
                            <HeroCard.Body>
                                <HeroText weight="semibold">Hero card</HeroText>
                                <HeroText size="sm">
                                    Content surface with hero roundness; colors come
                                    from the hero-light palette through the same
                                    --color-* contract daisy uses.
                                </HeroText>
                                <HeroInput
                                    placeholder="Your name"
                                    model={() => name.value}
                                />
                                <Row gap={8}>
                                    <HeroButton
                                        color="primary"
                                        size="sm"
                                        onPress={() => { state.modalOpen = true; }}
                                    >
                                        Open modal
                                    </HeroButton>
                                </Row>
                            </HeroCard.Body>
                        </HeroCard>

                        <HeroModal open={state.modalOpen} onClose={() => { state.modalOpen = false; }}>
                            <HeroModal.Header>
                                <HeroHeading level={4}>Hello{name.value ? `, ${name.value}` : ''}</HeroHeading>
                            </HeroModal.Header>
                            <HeroModal.Body>
                                <HeroText size="sm">
                                    A hero modal rendered inside the nested hero theme
                                    scope, dismissing on overlay tap.
                                </HeroText>
                            </HeroModal.Body>
                            <HeroModal.Actions>
                                <HeroButton color="primary" size="sm" onPress={() => { state.modalOpen = false; }}>
                                    Done
                                </HeroButton>
                            </HeroModal.Actions>
                        </HeroModal>
                    </Col>
                </ThemeProvider>
            </Col>
        </ScrollView>
    );
});
