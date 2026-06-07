import { component } from '@sigx/lynx';
import { Screen, useNav } from '@sigx/lynx-navigation';
import { Button, Col, Row, Text } from '@sigx/lynx-daisyui';
import { LucideIcon } from '@sigx/lynx-icons-lucide/components';

/**
 * Sheet presentation demo — this screen IS the sheet: the catalog row
 * pushes the `sheetDemo` route, whose `presentation: 'sheet'` slides this
 * up to the 0.4 snap point with the navigator's built-in dimmed backdrop.
 *
 * The grabber pill at the top is a visual affordance sitting inside the
 * navigator's ~28px drag strip — the strip itself is invisible and owned
 * by `<SheetDragHandle>`; this just shows the user where to grab.
 */
export const SheetDemo = component(() => {
    const nav = useNav();

    const tip = (icon: string, text: string) => (
        <Row style={{ alignItems: 'center', gap: '10px' }}>
            <LucideIcon name={icon as never} size={18} variant="neutral" />
            <Text class="text-base-content/80">{text}</Text>
        </Row>
    );

    return () => (
        <Screen snapPoints={[0.4, 0.9]} initialSnapIndex={0}>
            <Col
                class="bg-base-100"
                style={{
                    // Explicit viewport height: neither absolute top+bottom
                    // anchoring nor % heights stretch against the layer's
                    // absolutely-positioned host on Lynx — `100vh` keeps the
                    // surface opaque to the screen's bottom edge (the host
                    // is translated down, so overflow past the bottom is
                    // clipped by the Stack).
                    height: '100vh',
                    borderTopLeftRadius: '16px',
                    borderTopRightRadius: '16px',
                    paddingTop: '8px',
                    paddingLeft: '20px',
                    paddingRight: '20px',
                    alignItems: 'stretch',
                }}
            >
                {/* Grabber affordance, centered inside the drag strip. */}
                <Col style={{ alignItems: 'center', paddingBottom: '14px' }}>
                    <Col
                        class="bg-base-content/20"
                        style={{ width: '40px', height: '5px', borderRadius: '3px' }}
                    />
                </Col>

                <Text class="text-xl font-bold">Bottom sheet</Text>
                <Text class="text-base-content/60" style={{ marginBottom: '16px' }}>
                    {'presentation: "sheet" — snapPoints [0.4, 0.9], opens at 0.4'}
                </Text>

                <Col style={{ gap: '12px', marginBottom: '20px' }}>
                    {tip('move-vertical', 'Drag the strip at the top between the two detents')}
                    {tip('chevrons-down', 'Fling down (or drag past the lowest detent) to dismiss')}
                    {tip('mouse-pointer-click', 'Tap the dimmed backdrop to dismiss')}
                    {tip('moon', 'The dim tracks the sheet — deeper at 0.9 than at 0.4')}
                </Col>

                <Button color="primary" onPress={() => nav.pop()}>
                    Dismiss programmatically
                </Button>
            </Col>
        </Screen>
    );
});
