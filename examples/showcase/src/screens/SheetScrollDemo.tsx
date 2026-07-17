import { component, signal } from '@sigx/lynx';
import { Screen, useNav } from '@sigx/lynx-navigation';
import { ScrollView, Swipeable } from '@sigx/lynx-gestures';
import { Button, Col, Heading, Input, Row, Text } from '@sigx/lynx-daisyui';

/**
 * Sheet drag↔scroll arbitration demo — this screen IS the sheet
 * (`presentation: 'sheet'`), with a scrollable list, buttons, an input,
 * swipeable rows and a horizontal carousel inside. It exercises every
 * ownership path of the full-surface sheet drag:
 *
 *  - At 0.5: drag anywhere on the body → the SHEET moves (list is locked).
 *  - At 0.9: the list scrolls; drag down with the list at top → the sheet
 *    collapses; scroll the list up in one continuous pull to its top and
 *    keep pulling → mid-gesture handoff to the sheet.
 *  - Taps (buttons, counter), input focus, horizontal swipes (rows,
 *    carousel) work at every detent.
 *
 * The gestures `<ScrollView>` coordinates automatically (ScrollDragHost
 * adoption); raw `<scroll-view>`/`<list>` content should use
 * `<Screen dragHandle="grabber">` instead.
 */
export const SheetScrollDemo = component(() => {
    const nav = useNav();
    const taps = signal(0);
    const note = signal('');

    const rows = Array.from({ length: 40 }, (_, i) => i + 1);

    return () => (
        <Screen snapPoints={[0.5, 0.9]} initialSnapIndex={0}>
            <Col flex={1} class="bg-base-100 rounded-t-2xl">
                {/* Grabber affordance — the whole surface drags now; the pill
                    just marks the chrome zone that ALWAYS drags the sheet. */}
                <Col align="center" class="pt-2 pb-3">
                    <view class="w-10 h-1 rounded-full bg-base-300" />
                </Col>

                <Col gap={8} padding={{ x: 16, bottom: 8 }}>
                    <Heading level={3}>Sheet + scroll arbitration</Heading>
                    <Row gap={8} align="center">
                        <Button size="sm" onPress={() => { taps.value += 1; }}>
                            Taps: {taps.value}
                        </Button>
                        <Button size="sm" color="primary" onPress={() => nav.pop()}>
                            Dismiss
                        </Button>
                    </Row>
                    <Input placeholder="Tap to focus me" model={() => note.value} />
                </Col>

                <ScrollView class="flex-fill">
                    <Col gap={2} padding={{ x: 16, bottom: 24 }}>
                        <Text class="opacity-60 text-xs pb-1">
                            Expand to 0.9 to scroll · at the top, pull down to collapse
                        </Text>
                        {rows.map((n) =>
                            n >= 5 && n <= 7
                                ? (
                                    <Swipeable
                                        key={`row-${n}`}
                                        rightActionsWidth={88}
                                        rightActions={() => (
                                            <Row
                                                width="100%"
                                                height="100%"
                                                class="bg-error"
                                                align="center"
                                                justify="center"
                                            >
                                                <Text class="text-error-content text-sm">Delete</Text>
                                            </Row>
                                        )}
                                    >
                                        <Row class="py-3 border-b border-base-200" align="center">
                                            <Text class="text-sm">Row {n} — swipe me left</Text>
                                        </Row>
                                    </Swipeable>
                                )
                                : n === 12
                                    ? (
                                        <ScrollView
                                            key="carousel"
                                            scroll-orientation="horizontal"
                                            class="py-2"
                                        >
                                            <Row gap={8}>
                                                {rows.slice(0, 10).map((c) => (
                                                    <view
                                                        key={`card-${c}`}
                                                        class="w-24 h-16 rounded-xl bg-base-200 items-center justify-center"
                                                    >
                                                        <Text class="text-xs opacity-60">Card {c}</Text>
                                                    </view>
                                                ))}
                                            </Row>
                                        </ScrollView>
                                    )
                                    : (
                                        <Row
                                            key={`row-${n}`}
                                            class="py-3 border-b border-base-200"
                                            align="center"
                                        >
                                            <Text class="text-sm">Row {n}</Text>
                                        </Row>
                                    ),
                        )}
                    </Col>
                </ScrollView>
            </Col>
        </Screen>
    );
});
