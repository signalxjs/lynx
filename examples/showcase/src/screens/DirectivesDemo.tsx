import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, Heading, Row, ScrollView, Text } from '@sigx/lynx-daisyui';

/**
 * `use:show` — toggles an element's visibility via `display` while keeping it
 * mounted, vs conditional rendering (`{cond && <view/>}`) which unmounts and
 * remounts. Two things to notice:
 *   1. Toggling `show` emits a single style op (no element create/remove churn).
 *   2. The element keeps its native state while hidden — type into the field,
 *      hide it, show it: the text is still there. A `{cond && ...}` field would
 *      be recreated empty each time.
 */
export const DirectivesDemo = component(() => {
    const shown = signal(true);
    const mountedShown = signal(true);

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Directives" />
            <Col gap={16} padding={16}>
                <Heading level={2}>use:show</Heading>

                <Card bordered>
                    <Card.Body>
                        <Col gap={12}>
                            <Text weight="semibold">show — toggle visibility, keep state</Text>
                            <Text class="opacity-60 text-sm">
                                The element stays mounted; only its `display` is
                                toggled. Type below, hide, then show — the text
                                survives.
                            </Text>

                            <Button
                                size="sm"
                                variant="outline"
                                onPress={() => { shown.value = !shown.value; }}
                            >
                                {shown.value ? 'Hide' : 'Show'} (use:show)
                            </Button>

                            <view use:show={shown.value} class="rounded-box bg-base-200 p-4">
                                <Col gap={8}>
                                    <Text>I stay mounted while hidden.</Text>
                                    <input
                                        class="input input-bordered w-full"
                                        placeholder="Type, hide me, show me again…"
                                    />
                                </Col>
                            </view>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={12}>
                            <Text weight="semibold">Contrast: conditional render</Text>
                            <Text class="opacity-60 text-sm">
                                The same field via `{'{'}cond && …{'}'}` — hiding
                                unmounts it, so its text is gone on the way back.
                            </Text>

                            <Button
                                size="sm"
                                variant="outline"
                                onPress={() => { mountedShown.value = !mountedShown.value; }}
                            >
                                {mountedShown.value ? 'Hide' : 'Show'} (conditional)
                            </Button>

                            {mountedShown.value && (
                                <view class="rounded-box bg-base-200 p-4">
                                    <Col gap={8}>
                                        <Text>I get unmounted when hidden.</Text>
                                        <input
                                            class="input input-bordered w-full"
                                            placeholder="Type, hide me — I come back empty"
                                        />
                                    </Col>
                                </view>
                            )}
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
