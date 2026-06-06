import { component } from '@sigx/lynx';
import {
    Button,
    Col,
    Heading,
    Row,
    Text,
    ThemeProvider,
    useTheme,
    type TextColor,
    type TextSize,
    type TextWeight,
} from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Text — the token-driven size ramp, weights, semantic colors, and the live
 * global font-scale lever (`controller.setFontScale`).
 *
 * The size ramp resolves to the `--text-*` tokens (xs 12px … base 17px …
 * 3xl 34px). `fontScale` multiplies that ramp on top, independent of theme.
 */

// Default ramp px (mirrors `--text-*`); used only to label rows — the actual
// size comes from the token the `size` utility resolves to.
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
const COLORS: TextColor[] = [
    'base-content', 'primary', 'secondary', 'accent',
    'info', 'success', 'warning', 'error',
];
const SCALES = [0.85, 1, 1.25, 1.5] as const;

/** Nested-scope sample whose font scale is driven by the local theme controller. */
const ScaleSample = component(() => {
    const theme = useTheme();

    return () => (
        <Col gap={12}>
            <Row gap={8} class="flex-wrap">
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

export const textDemo: DaisyComponentDemo = {
    id: 'text',
    title: 'Text',
    description: 'Size ramp, weights, semantic colors and the live font-scale lever',
    icon: { set: 'lucide', name: 'type' },
    sections: [
        {
            title: 'Sizes',
            note: 'token-driven ramp (--text-xs … --text-3xl) at the default scale',
            Demo: component(() => () => (
                <Col gap={10}>
                    {RAMP.map(({ size, px }) => (
                        <Row key={size} align="center" justify="space-between" gap={12}>
                            <Text size={size}>Aa — {size}</Text>
                            <Text class="opacity-50 text-sm">{px}px</Text>
                        </Row>
                    ))}
                </Col>
            )),
        },
        {
            title: 'Weights',
            Demo: component(() => () => (
                <Col gap={8}>
                    {WEIGHTS.map((w) => (
                        <Text key={w} size="lg" weight={w}>{w} — The quick brown fox</Text>
                    ))}
                </Col>
            )),
        },
        {
            title: 'Colors',
            note: 'semantic tokens — recolor with the theme',
            Demo: component(() => () => (
                <Col gap={6}>
                    {COLORS.map((c) => (
                        <Text key={c} size="lg" weight="medium" color={c}>{c}</Text>
                    ))}
                </Col>
            )),
        },
        {
            title: 'Live scale (setFontScale)',
            note: 'scoped to a nested ThemeProvider so the ramp above stays at 1×',
            Demo: component(() => {
                // Pin the nested sample to the ambient theme so it scales fonts
                // without recoloring away from the app's current theme.
                const theme = useTheme();
                return () => (
                    <ThemeProvider
                        initial={theme.name}
                        style={{ flexGrow: 0, flexBasis: 'auto', borderRadius: 16 }}
                    >
                        <ScaleSample />
                    </ThemeProvider>
                );
            }),
        },
    ],
};
