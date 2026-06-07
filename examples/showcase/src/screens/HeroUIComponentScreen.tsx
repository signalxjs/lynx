import { component } from '@sigx/lynx';
import { Screen, useParams } from '@sigx/lynx-navigation';
import { Card, Center, Col, ScrollView, Text, ThemeProvider } from '@sigx/lynx-heroui';
import { getHeroDemo } from '../heroui/registry.js';

/**
 * HeroUI component reference page — one generic, data-driven screen serves
 * every component in the hero registry (mirror of `DaisyComponentScreen`).
 *
 * The whole page body sits inside a nested `<ThemeProvider initial="hero-light">`
 * so every section renders in the hero palette/radius regardless of the app's
 * daisy theme — the same sub-scope mechanism the HeroUI Lab A/B demo uses
 * (safe inside scroll content since #269: nested providers size to content).
 */
export const HeroUIComponentScreen = component(() => {
    const { componentId } = useParams('heroui');

    return () => {
        const demo = getHeroDemo(componentId);

        if (!demo) {
            return (
                <Center flex={1} class="bg-base-100 p-6">
                    <Screen title="HeroUI" />
                    <Text class="opacity-60">Unknown component "{componentId}"</Text>
                </Center>
            );
        }

        return (
            <ScrollView class="flex-fill bg-base-100">
                <Screen title={demo.title} />
                <ThemeProvider initial="hero-light">
                    <Col gap={16} padding={16}>
                        <Text class="opacity-60">{demo.description}</Text>
                        {/* Keyed by demo id + section title: stable across registry
                            reorders, unique within a demo (registry data is static). */}
                        {demo.sections.map((section) => (
                            <Card bordered key={`${demo.id}:${section.title}`}>
                                <Card.Body>
                                    <Col gap={12}>
                                        <Col gap={2}>
                                            <Text weight="semibold">{section.title}</Text>
                                            {section.note
                                                ? <Text class="opacity-60" size="sm">{section.note}</Text>
                                                : null}
                                        </Col>
                                        <section.Demo />
                                    </Col>
                                </Card.Body>
                            </Card>
                        ))}
                    </Col>
                </ThemeProvider>
            </ScrollView>
        );
    };
});
