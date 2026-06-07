import { component } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Card, Heading, Text } from '@sigx/lynx-daisyui';
// Deliberately imported straight from the foundation package — this page
// documents what `@sigx/lynx-zero` itself provides, independent of any
// design system. Everything below renders in the app's daisy theme because
// zero primitives are theme-agnostic.
import {
    Row, Col, Center, Spacer, ScrollView,
    COLOR_VARIANT_LIST, listThemes, colorsOf, useTheme,
} from '@sigx/lynx-zero';

/**
 * Foundation (lynx-zero) — makes the UI layering visible: the neutral
 * foundation package both design systems (daisyui, heroui) build on.
 *
 *   @sigx/lynx-zero   contract types · theme engine · layout primitives
 *   ├─ @sigx/lynx-daisyui   (DS #1 — daisy CSS, 6 built-in palettes)
 *   └─ @sigx/lynx-heroui    (DS #2 — hero- CSS, hero palettes)
 */
export const Foundation = component(() => {
    const theme = useTheme();

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Foundation" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Foundation (lynx-zero)</Heading>
                <Text class="opacity-60">
                    The design-system-neutral package both daisyui and heroui build
                    on: the props/token contract, the theme engine, and layout
                    primitives. Everything on this page is imported straight from
                    @sigx/lynx-zero.
                </Text>

                <Card bordered>
                    <Card.Body>
                        <Col gap={12}>
                            <Col gap={2}>
                                <Text weight="semibold">Layout primitives</Text>
                                <Text class="opacity-60 text-sm">
                                    Row / Col / Center / Spacer / ScrollView — flexbox
                                    shorthands with gap/padding/align props
                                </Text>
                            </Col>
                            <Col gap={8}>
                                <Row gap={8}>
                                    <view class="bg-primary rounded-md" style={{ width: 40, height: 40 }} />
                                    <view class="bg-secondary rounded-md" style={{ width: 40, height: 40 }} />
                                    <Spacer />
                                    <view class="bg-accent rounded-md" style={{ width: 40, height: 40 }} />
                                </Row>
                                <Text class="opacity-60 text-sm">
                                    ↑ Row with gap; Spacer pushes the last box to the edge
                                </Text>
                                <Center class="bg-base-200 rounded-md" style={{ height: 64 }}>
                                    <Text class="text-sm">Center</Text>
                                </Center>
                            </Col>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={12}>
                            <Col gap={2}>
                                <Text weight="semibold">Color contract</Text>
                                <Text class="opacity-60 text-sm">
                                    Eight semantic variants; every theme supplies each as
                                    --color-*, with a -content pairing and a computed
                                    -soft tint. Both design systems read the same names.
                                </Text>
                            </Col>
                            <Col gap={6}>
                                {COLOR_VARIANT_LIST.map((variant) => (
                                    <Row gap={8} align="center" key={variant}>
                                        <view class={`bg-${variant} rounded-md`} style={{ width: 28, height: 28 }} />
                                        <view class={`bg-${variant}-soft rounded-md`} style={{ width: 28, height: 28 }} />
                                        <Text class="text-sm">{variant}</Text>
                                    </Row>
                                ))}
                            </Col>
                            <Text class="opacity-60 text-sm">
                                solid · soft tint (computed at theme registration)
                            </Text>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={12}>
                            <Col gap={2}>
                                <Text weight="semibold">Theme registry</Text>
                                <Text class="opacity-60 text-sm">
                                    One engine, every theme from every design system —
                                    registerTheme() seeds it, ThemeProvider scopes it,
                                    themeController drives it headlessly
                                </Text>
                            </Col>
                            <Col gap={6}>
                                {listThemes().map((t) => (
                                    <Row gap={8} align="center" key={t.name}>
                                        <view
                                            class="rounded-md border border-base-300"
                                            style={{ width: 20, height: 20, backgroundColor: colorsOf(t.name)?.primary ?? 'transparent' }}
                                        />
                                        <Text class="text-sm">{t.name}</Text>
                                        <Text class="opacity-60 text-sm">({t.variant})</Text>
                                        {theme.name === t.name
                                            ? <Text class="text-sm text-primary">← active</Text>
                                            : null}
                                    </Row>
                                ))}
                            </Col>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">The layering</Text>
                            <Text class="text-sm opacity-80">@sigx/lynx-zero — contract · theme engine · primitives</Text>
                            <Text class="text-sm opacity-80 pl-4">├─ @sigx/lynx-daisyui — daisy CSS, 6 built-in palettes</Text>
                            <Text class="text-sm opacity-80 pl-4">└─ @sigx/lynx-heroui — hero- CSS, hero palettes</Text>
                            <Text class="opacity-60 text-sm">
                                Apps import the DS they chose; switching is mostly an
                                import swap because the contract (color/size props,
                                token names, theme API) is shared.
                            </Text>
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
