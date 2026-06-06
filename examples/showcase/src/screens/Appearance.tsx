import { component } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import {
    Button,
    Card,
    Col,
    Heading,
    listThemes,
    Row,
    ScrollView,
    Text,
    Toggle,
    useTheme,
    variantOf,
    type DaisyTheme,
} from '@sigx/lynx-daisyui';
import { useSystemColorScheme } from '@sigx/lynx-appearance';
import { Haptics } from '@sigx/lynx-haptics';

/**
 * Appearance — global theme switching via daisyui's theme controller.
 *
 *  • Pick any registered theme (built-ins plus the custom acme pair from
 *    `themes.ts`), pinning the controller to it.
 *  • `theme.toggle()` flips between the active variant's light/dark pair.
 *  • `theme.followSystem()` resumes OS color-scheme auto-detection
 *    (surfaced live via `useSystemColorScheme`).
 */
export const Appearance = component(() => {
    const theme = useTheme();
    const systemScheme = useSystemColorScheme();

    const pickTheme = (name: DaisyTheme) => {
        Haptics.selection();
        theme.set(name);
    };

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Appearance" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Appearance</Heading>

                <Card bordered>
                    <Card.Body>
                        <Col gap={12}>
                            <Col gap={2}>
                                <Text weight="semibold">Theme</Text>
                                <Text class="opacity-60 text-sm">
                                    System: {systemScheme.value} ·{' '}
                                    {theme.followingSystem
                                        ? 'following system'
                                        : `pinned to ${theme.name}`}
                                </Text>
                            </Col>
                            <Row gap={8} wrap>
                                {listThemes().map((meta) => (
                                    <Button
                                        key={meta.name}
                                        size="sm"
                                        color={theme.name === meta.name ? 'primary' : undefined}
                                        variant={theme.name === meta.name ? undefined : 'outline'}
                                        onPress={() => pickTheme(meta.name)}
                                    >
                                        {meta.name.replace('daisy-', '')} ({meta.variant[0]})
                                    </Button>
                                ))}
                            </Row>
                            <Row gap={8}>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onPress={() => {
                                        Haptics.selection();
                                        theme.toggle();
                                    }}
                                >
                                    Toggle (pair)
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onPress={() => {
                                        Haptics.selection();
                                        theme.followSystem();
                                    }}
                                >
                                    Follow system
                                </Button>
                            </Row>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Quick dark toggle</Text>
                            <Text class="opacity-60 text-sm">
                                Flips between the active variant's pair via
                                theme.toggle(). Pins the theme — tap "Follow
                                system" above to resume auto-detection.
                            </Text>
                            <Row align="center" justify="space-between">
                                <Text>Dark variant active</Text>
                                {/* variantOf reads the registry — name
                                    substring checks mis-detect runtime-
                                    registered pairs. */}
                                <Toggle
                                    checked={variantOf(theme.name) === 'dark'}
                                    onChange={() => {
                                        Haptics.selection();
                                        theme.toggle();
                                    }}
                                />
                            </Row>
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
