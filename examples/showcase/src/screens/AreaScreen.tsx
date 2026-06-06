import { component } from '@sigx/lynx';
import { Screen, useNav, useParams } from '@sigx/lynx-navigation';
import { Center, Col, Row, Text } from '@sigx/lynx-daisyui';
import { Haptics } from '@sigx/lynx-haptics';
import { LucideIcon } from '@sigx/lynx-icons-lucide/components';
import { getArea, type Example } from '../catalog.js';

/**
 * Area sub view — one generic, data-driven screen serves every catalog
 * area. The `areaId` param selects the section; rows push the example's
 * registered route.
 */
export const AreaScreen = component(() => {
    const nav = useNav();
    const { areaId } = useParams('area');

    const openExample = (example: Example) => {
        Haptics.selection();
        // The discriminated Example union ties `params` to the parametric
        // `daisyui` route, so both branches are fully typed.
        if (example.params) nav.push(example.route, example.params);
        else nav.push(example.route);
    };

    return () => {
        const area = getArea(areaId);

        if (!area) {
            return (
                <Center flex={1} class="bg-base-100 p-6">
                    <Screen title="Examples" />
                    <Text class="opacity-60">Unknown area "{areaId}"</Text>
                </Center>
            );
        }

        return (
            <view class="flex-fill bg-base-100">
                <Screen title={area.title} />
                <list
                    class="flex-1"
                    list-type="single"
                    span-count={1}
                    scroll-orientation="vertical"
                >
                    {area.examples.map((example) => (
                        <list-item key={example.id} item-key={example.id}>
                            <view
                                class="px-4 py-1"
                                bindtap={() => openExample(example)}
                                accessibility-element={true}
                                accessibility-label={`Open ${example.title}`}
                                accessibility-trait="button"
                            >
                                <Row gap={12} align="center" class="border border-base-300 rounded-xl px-4 py-3">
                                    <LucideIcon name={example.icon.name} size={22} variant="primary" />
                                    <Col gap={2} class="flex-1">
                                        <Text weight="semibold">{example.title}</Text>
                                        <Text class="opacity-60 text-sm">{example.description}</Text>
                                    </Col>
                                    <LucideIcon name="chevron-right" size={18} variant="neutral" />
                                </Row>
                            </view>
                        </list-item>
                    ))}
                </list>
            </view>
        );
    };
});
