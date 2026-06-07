import { component } from '@sigx/lynx';
import { Screen, useNav } from '@sigx/lynx-navigation';
import { Button, Col, Heading, Text } from '@sigx/lynx-daisyui';

/**
 * Sheet presentation demo — this screen IS the sheet: the catalog row
 * pushes the `sheetDemo` route, whose `presentation: 'sheet'` slides this
 * up to the 0.4 snap point with the navigator's built-in dimmed backdrop.
 *
 * The grabber pill at the top is a visual affordance sitting inside the
 * navigator's ~28px drag strip — the strip itself is invisible and owned
 * by the navigator; this just shows the user where to grab.
 *
 * Styling follows the showcase screen conventions (Keyboard/HapticsDemo):
 * daisy utility classes + `<Col gap padding>` props — inline px padding
 * styles don't reliably apply on device.
 */
export const SheetDemo = component(() => {
    const nav = useNav();

    return () => (
        <Screen snapPoints={[0.4, 0.9]} initialSnapIndex={0}>
            {/* flex={1} (Col's typed prop — Col has no `style` prop, inline
                styles are silently dropped) fills the layer host so the
                surface stays opaque to the screen's bottom edge at every
                detent. */}
            <Col flex={1} class="bg-base-100 rounded-t-2xl">
                {/* Grabber affordance, centered inside the drag strip. */}
                <Col align="center" class="pt-2 pb-3">
                    <view class="w-10 h-1 rounded-full bg-base-300" />
                </Col>

                <Col gap={12} padding={16} class="pt-0">
                    <Col gap={4}>
                        <Heading level={3}>Bottom sheet</Heading>
                        <Text class="opacity-60 text-sm">
                            {'presentation: "sheet" — snapPoints [0.4, 0.9], opens at 0.4'}
                        </Text>
                    </Col>

                    <Col gap={6}>
                        <Text class="text-sm">• Drag the strip at the top between the two detents</Text>
                        <Text class="text-sm">• Fling down (or drag past the lowest detent) to dismiss</Text>
                        <Text class="text-sm">• Tap the dimmed backdrop to dismiss</Text>
                        <Text class="text-sm">• The dim tracks the sheet — deeper at 0.9 than at 0.4</Text>
                    </Col>

                    <Button color="primary" onPress={() => nav.pop()}>
                        Dismiss programmatically
                    </Button>
                </Col>
            </Col>
        </Screen>
    );
});
