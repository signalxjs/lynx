import { component, useElementLayout } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Card, Col, Heading, ScrollView, Text } from '@sigx/lynx-daisyui';

/**
 * Text & layout APIs — the Lynx 3.7/3.8 additions surfaced through the
 * framework:
 *
 *  • `<Text selectable>` maps to Lynx's `text-selection` attribute — the
 *    system selection handles + Copy/Share menu work on long-press.
 *  • `<Text autoSize>` maps to the `-x-auto-font-size` CSS family —
 *    min/max/step ranges, preset sizes, and (Lynx 3.8) per-line-count
 *    `line-range()` shrinking.
 *  • `useElementLayout` wraps the new `bindlayoutchange` event as a signal
 *    reporting the element's measured size and page position.
 */
export const TextApis = component(() => {
    const { layout: cardLayout, onLayoutChange } = useElementLayout();

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Text APIs" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Text APIs</Heading>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Selectable text</Text>
                            <Text class="opacity-60 text-sm">
                                Long-press the paragraph below to select text and
                                copy via the system menu. Powered by daisyui's
                                `selectable` prop on `Text`, which maps to Lynx's
                                `text-selection` attribute.
                            </Text>
                            <Text selectable>
                                Long-press anywhere in this sentence. The system
                                selection handles should appear and the platform
                                Copy / Share menu should open on iOS and Android.
                            </Text>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Auto font-size</Text>
                            <Text class="opacity-60 text-sm">
                                The headline below starts at 2xl and shrinks to
                                fit one line in a 180px container — raw Lynx
                                `-x-auto-font-size` CSS on a native text
                                element (min 12px).
                            </Text>
                            <view class="bg-base-200 rounded-lg p-2" style={{ width: '180px' }}>
                                <text class="text-2xl font-bold" number-of-lines={1} style={{ '-x-auto-font-size': 'true 12px' }}>
                                    A long headline that must fit one line
                                </text>
                            </view>
                            <Text class="opacity-60 text-sm">
                                This one uses per-line-count ranges (Lynx 3.8's
                                `line-range()`): big while it fits one line,
                                smaller once it wraps.
                            </Text>
                            <Text
                                weight="bold"
                                autoSize={{
                                    lineRanges: [
                                        { lines: 1, min: '18px', max: '24px' },
                                        { lines: [2, 'infinity'], min: '14px' },
                                    ],
                                }}
                            >
                                Resize-aware headline — shrinks as it wraps onto
                                more lines instead of overflowing the card.
                            </Text>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">useElementLayout</Text>
                            <Text class="opacity-60 text-sm">
                                The view below reports its own measured size and
                                page position via the `bindlayoutchange` event,
                                surfaced as a signal by `useElementLayout`.
                            </Text>
                            <view
                                class="bg-base-200 rounded-lg p-4"
                                bindlayoutchange={onLayoutChange}
                            >
                                <Text class="font-mono text-sm">
                                    width: {cardLayout.value?.width ?? '—'}{'\n'}
                                    height: {cardLayout.value?.height ?? '—'}{'\n'}
                                    top: {cardLayout.value?.top ?? '—'}{'\n'}
                                    left: {cardLayout.value?.left ?? '—'}
                                </Text>
                            </view>
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
