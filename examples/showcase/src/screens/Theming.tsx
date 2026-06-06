import { component } from '@sigx/lynx';
import { Screen, useNav } from '@sigx/lynx-navigation';
import {
    Button,
    Card,
    Col,
    Heading,
    ScrollView,
    Text,
    ThemeProvider,
    useScreenTheme,
} from '@sigx/lynx-daisyui';

/**
 * Theming — shows the two theming layers side by side:
 *
 *  • `useScreenTheme('daisy-dark')` pins the **global** theme while this screen
 *    is focused, so the whole surface — *including the OS status-bar icons* —
 *    goes dark, and restores when you pop back.
 *  • The nested `<ThemeProvider initial="daisy-synthwave">` recolors only its
 *    own card (a content sub-scope). The status bar stays on the screen theme —
 *    a sub-scope can't touch the OS bars.
 */
export const Theming = component(() => {
    // Whole screen (content + status bar) is dark while focused; restored on pop.
    useScreenTheme('daisy-dark');
    const nav = useNav();

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Theming" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Theming</Heading>
                <Text class="opacity-60 text-sm">
                    This screen calls useScreenTheme('daisy-dark'): the whole
                    surface — including the status-bar icons — goes dark while
                    it's focused, then restores when you go back.
                </Text>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Global / screen theme</Text>
                            <Text class="opacity-60 text-sm">
                                Driven by the global controller, so the OS bars
                                follow it. The panel below overrides only its own
                                subtree and leaves the bars alone.
                            </Text>
                        </Col>
                    </Card.Body>
                </Card>

                {/* Content sub-scope: recolors this subtree only. flexGrow:0 so the
                    flex-fill host sizes to its content instead of filling. */}
                <ThemeProvider
                    initial="daisy-synthwave"
                    style={{ flexGrow: 0, flexBasis: 'auto', borderRadius: 16 }}
                >
                    <Card bordered>
                        <Card.Body>
                            <Col gap={8}>
                                <Text weight="semibold">Nested override — synthwave</Text>
                                <Text class="opacity-60 text-sm">
                                    Wrapped in a nested ThemeProvider. Content
                                    recolors; the status bar stays dark.
                                </Text>
                                <Button color="primary">Synthwave button</Button>
                            </Col>
                        </Card.Body>
                    </Card>
                </ThemeProvider>

                <Button variant="outline" onPress={() => nav.pop()}>
                    Back
                </Button>
            </Col>
        </ScrollView>
    );
});
