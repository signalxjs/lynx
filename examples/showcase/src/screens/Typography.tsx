import { component } from '@sigx/lynx';
import { Screen, useNav } from '@sigx/lynx-navigation';
import {
    Button,
    Card,
    Col,
    Heading,
    Row,
    ScrollView,
    Text,
    ThemeProvider,
    useTheme,
    type TextSize,
    type TextWeight,
} from '@sigx/lynx-daisyui';

/**
 * Typography — exercises the daisy text ramp end to end.
 *
 *  • The static ramp section proves `<Text size>` / `<Heading>` resolve to the
 *    `--text-*` tokens at the default scale (xs 12px … base 17px … 3xl 34px).
 *  • The "Live scale" section drives `controller.setFontScale()` — the global,
 *    theme-independent text-scale lever a real app would wire to a user
 *    accessibility preference or a backend setting. It's scoped here to a nested
 *    `<ThemeProvider>` so the reference ramp above stays at 1× for comparison;
 *    in production you'd call it on the root controller to scale the whole app.
 */

// The default ramp px (mirrors `--text-*` in the daisyui tokens). Used only to
// label rows — the actual size comes from the token the utility resolves to.
const RAMP: { size: TextSize; px: number }[] = [
    { size: 'xs', px: 12 },
    { size: 'sm', px: 14 },
    { size: 'base', px: 17 },
    { size: 'lg', px: 20 },
    { size: 'xl', px: 24 },
    { size: '2xl', px: 28 },
    { size: '3xl', px: 34 },
];

const WEIGHTS: TextWeight[] = ['light', 'normal', 'medium', 'semibold', 'bold'];
const SCALES = [0.85, 1, 1.25, 1.5] as const;

/** Nested-scope sample whose font scale is driven by the local theme controller. */
const ScaleSample = component(() => {
    const theme = useTheme();

    return () => (
        <Col gap={12}>
            <Row gap={8} wrap>
                {SCALES.map((s) => (
                    <Button
                        key={s}
                        size="sm"
                        variant={theme.fontScale === s ? 'primary' : 'ghost'}
                        outline={theme.fontScale !== s}
                        onPress={() => theme.setFontScale(s)}
                    >
                        {Math.round(s * 100)}%
                    </Button>
                ))}
            </Row>
            <Text class="opacity-60 text-sm">
                Scale {Math.round(theme.fontScale * 100)}% · base ≈ {Math.round(17 * theme.fontScale)}px
            </Text>
            <Heading level={3}>The quick brown fox</Heading>
            <Text size="base">
                Body text at the current scale. Every size in the ramp moves
                together because they all resolve to the scaled --text-* tokens.
            </Text>
            <Text size="sm" class="opacity-70">Small print scales too.</Text>
        </Col>
    );
});

export const Typography = component(() => {
    const nav = useNav();
    // The ambient theme — pin the nested sample to it so it scales fonts without
    // recoloring away from the app's current theme.
    const theme = useTheme();

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Typography" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Typography</Heading>
                <Text class="opacity-60 text-sm">
                    The text ramp is token-driven (--text-xs … --text-3xl). A
                    global fontScale multiplies it on top, independent of theme.
                </Text>

                {/* Static ramp at the app's default scale. */}
                <Card bordered>
                    <Card.Body>
                        <Col gap={10}>
                            <Text weight="semibold">Sizes (default ramp)</Text>
                            {RAMP.map(({ size, px }) => (
                                <Row key={size} align="center" justify="space-between" gap={12}>
                                    <Text size={size}>Aa — {size}</Text>
                                    <Text class="opacity-50 text-sm">{px}px</Text>
                                </Row>
                            ))}
                        </Col>
                    </Card.Body>
                </Card>

                {/* Default <Text> (no size prop) — should land on base (17px). */}
                <Card bordered>
                    <Card.Body>
                        <Col gap={4}>
                            <Text weight="semibold">Default size</Text>
                            <Text>Plain &lt;Text&gt; with no size prop (defaults to base / 17px).</Text>
                        </Col>
                    </Card.Body>
                </Card>

                {/* Live scale — drives controller.setFontScale() in a nested scope.
                    flexGrow:0 so the flex-fill host sizes to content. */}
                <ThemeProvider
                    initial={theme.name}
                    style={{ flexGrow: 0, flexBasis: 'auto', borderRadius: 16 }}
                >
                    <Card bordered>
                        <Card.Body>
                            <Col gap={10}>
                                <Text weight="semibold">Live scale (setFontScale)</Text>
                                <ScaleSample />
                            </Col>
                        </Card.Body>
                    </Card>
                </ThemeProvider>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Weights</Text>
                            {WEIGHTS.map((w) => (
                                <Text key={w} size="lg" weight={w}>{w} — The quick brown fox</Text>
                            ))}
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Headings</Text>
                            <Heading level={1}>Heading 1</Heading>
                            <Heading level={2}>Heading 2</Heading>
                            <Heading level={3}>Heading 3</Heading>
                            <Heading level={4}>Heading 4</Heading>
                            <Heading level={5}>Heading 5</Heading>
                            <Heading level={6}>Heading 6</Heading>
                        </Col>
                    </Card.Body>
                </Card>

                <Button outline onPress={() => nav.pop()}>Back</Button>
            </Col>
        </ScrollView>
    );
});
