import { component } from '@sigx/lynx';
import { Screen, useParams } from '@sigx/lynx-navigation';
import { Card, Center, Col, ScrollView, Text } from '@sigx/lynx-daisyui';
import { getDaisyDemo } from '../daisyui/registry.js';

/**
 * DaisyUI component reference page — one generic, data-driven screen serves
 * every component in the registry (same pattern as `AreaScreen` for areas).
 * The `componentId` param selects the entry; each section renders in its own
 * bordered card.
 */
export const DaisyComponentScreen = component(() => {
    const { componentId } = useParams('daisyui');

    return () => {
        const demo = getDaisyDemo(componentId);

        if (!demo) {
            return (
                <Center flex={1} class="bg-base-100 p-6">
                    <Screen title="DaisyUI" />
                    <Text class="opacity-60">Unknown component "{componentId}"</Text>
                </Center>
            );
        }

        return (
            <ScrollView class="flex-fill bg-base-100">
                <Screen title={demo.title} />
                <Col gap={16} padding={16}>
                    <Text class="opacity-60">{demo.description}</Text>
                    {demo.sections.map((section) => (
                        <Card bordered key={section.title}>
                            <Card.Body>
                                <Col gap={12}>
                                    <Col gap={2}>
                                        <Text weight="semibold">{section.title}</Text>
                                        {section.note
                                            ? <Text class="opacity-60 text-sm">{section.note}</Text>
                                            : null}
                                    </Col>
                                    <section.Demo />
                                </Col>
                            </Card.Body>
                        </Card>
                    ))}
                </Col>
            </ScrollView>
        );
    };
});
