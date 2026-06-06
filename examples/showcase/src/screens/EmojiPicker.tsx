import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, EmojiPickerSheet, emojiClasses, Heading, Row, Text } from '@sigx/lynx-daisyui';
import { EmojiPicker, EmojiProvider, enData, type EmojiPickEvent } from '@sigx/lynx-emoji';

/**
 * Emoji picker (`@sigx/lynx-emoji`) — the headless picker themed with
 * daisyui's `emojiClasses`, plus the `EmojiPickerSheet` overlay wrapper.
 *
 *  • Grid: native `<list span-count>` recycler over the full ~1900-emoji
 *    en dataset (generated from emojibase), one category at a time.
 *  • Search: ranked keyword/shortcode search (type "fire", "thumbs"…).
 *  • Long-press a people/hand emoji for the skin-tone popover — the choice
 *    is sticky (grid-wide) and persists via `@sigx/lynx-storage`.
 *  • Recents (🕘 tab) persist across relaunch.
 *  • Both surfaces share one `<EmojiProvider>`, so a pick in the sheet
 *    shows up in the inline picker's recents immediately.
 */
export const EmojiPickerScreen = component(() => {
    const picked = signal('');
    const sheetOpen = signal(false);
    const onPick = (e: EmojiPickEvent): void => {
        picked.value = picked.value + e.glyph;
    };

    return () => (
        <EmojiProvider data={enData}>
            <view class="flex-fill bg-base-100" style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
                <Screen title="Emoji picker" />
                <Col gap={12} padding={16} class="flex-fill">
                    <Card bordered>
                        <Card.Body>
                            <Row gap={8} class="items-center">
                                <Heading level={4}>Picked:</Heading>
                                <Text size="lg" class="flex-1">{picked.value || '—'}</Text>
                                <Button size="sm" variant="ghost" outline onPress={() => { picked.value = ''; }}>Clear</Button>
                                <Button size="sm" variant="primary" onPress={() => { sheetOpen.value = true; }}>Sheet</Button>
                            </Row>
                        </Card.Body>
                    </Card>

                    <view class="flex-1 border border-base-300 rounded-lg overflow-hidden" style={{ minHeight: '320px', display: 'flex', flexDirection: 'column' }}>
                        <EmojiPicker classes={emojiClasses} onPick={onPick} />
                    </view>
                </Col>

                <EmojiPickerSheet
                    open={sheetOpen.value}
                    onPick={onPick}
                    onClose={() => { sheetOpen.value = false; }}
                />
            </view>
        </EmojiProvider>
    );
});
