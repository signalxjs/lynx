import { component } from '@sigx/lynx';
import { useDrawer } from '@sigx/lynx-navigation';
import {
    Button,
    Col,
    Heading,
    Row,
    Text,
    Toggle,
    useTheme,
} from '@sigx/lynx-daisyui';
import { Haptics } from '@sigx/lynx-haptics';

/**
 * Sidebar contents for `<NavDrawer>` in the showcase root. Demonstrates a
 * couple of cross-screen affordances — theme switch and a close button —
 * to give the drawer a reason to exist alongside the tab bar.
 */
export const ShowcaseMenu = component(() => {
    const theme = useTheme();
    const drawer = useDrawer();

    return () => (
        <Col gap={20} padding={20} class="flex-fill">
            <Heading level={3}>Showcase</Heading>

            <Row align="center" justify="space-between">
                <Col gap={2}>
                    <Text weight="semibold">Dark theme</Text>
                    <Text class="opacity-60 text-sm">Toggle daisy-light / daisy-dark</Text>
                </Col>
                <Toggle
                    checked={theme.name === 'daisy-dark'}
                    onChange={() => {
                        Haptics.selection();
                        theme.toggle();
                    }}
                />
            </Row>

            <view class="flex-1" />

            <Button variant="ghost" onPress={() => drawer.close()}>
                Close
            </Button>
            <Row align="center" justify="space-between">
                <Text class="opacity-60 text-sm">Version</Text>
                <Text class="text-sm">0.1.0</Text>
            </Row>
        </Col>
    );
});
