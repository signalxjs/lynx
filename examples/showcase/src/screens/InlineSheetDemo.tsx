import { component, signal } from '@sigx/lynx';
import { ScrollView, TOUCH_GUARD_TAG } from '@sigx/lynx-gestures';
import { Screen } from '@sigx/lynx-navigation';
import { useSafeAreaInsets } from '@sigx/lynx-safe-area';
import { BottomSheet } from '@sigx/lynx-sheet';
import { Button, Col, Heading, Text } from '@sigx/lynx-daisyui';

/** Navigator header height (dp) — matches the showcase's Screen chrome. */
const HEADER_H = 56;

/**
 * Standalone `<BottomSheet>` demo — the modal tray WITHOUT a route: this
 * plain card screen hosts a dismissible, backdropped, full-surface-drag
 * sheet from `@sigx/lynx-sheet`. Contrast with `SheetDemo`, where the
 * navigator route IS the sheet.
 *
 * Exercises the three features the old inline sheet lacked:
 * - `dismissible`: fling/drag below half the floor parks at 0 + `dismiss`
 * - `backdrop`: dim tracks the reveal, tap-to-dismiss, inert while parked
 * - `dragMode="surface"`: the whole panel drags, arbitrating against the
 *   inner gestures `<ScrollView>` (drag the list down from its top to
 *   collapse the sheet; scroll runs free only at the top detent)
 *
 * Layout note: the sheet + backdrop are the LAST children of a full-bleed
 * positioned container — Lynx stacks by document order (no z-index), so
 * this is what makes the dim cover the whole screen.
 */
export const InlineSheetDemo = component(() => {
    const state = signal({ open: false, lastEvent: '(none yet)' });
    const insets = useSafeAreaInsets();

    return () => (
        <view
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                flexDirection: 'column',
            }}
            class="bg-base-100"
        >
            <Screen title="Inline sheet" />
            <Col gap={12} padding={16}>
                <Heading level={2}>Standalone BottomSheet</Heading>
                <Text class="opacity-60 text-sm">
                    {'@sigx/lynx-sheet — no route: dismissible + backdrop + dragMode="surface"'}
                </Text>
                <Col gap={6}>
                    <Text class="text-sm">• Open, then drag the sheet by its body</Text>
                    <Text class="text-sm">• At the top detent the list scrolls; at its top edge, dragging down hands back to the sheet</Text>
                    <Text class="text-sm">• Fling down or tap the dim to dismiss</Text>
                </Col>
                <Button color="primary" onPress={() => { state.open = true; }}>
                    Open sheet
                </Button>
                <Text class="text-xs opacity-60">{`Last event: ${state.lastEvent}`}</Text>
            </Col>

            <BottomSheet
                detents={[120, { fraction: 0.45 }, { fraction: 0.9 }]}
                open={state.open}
                animate
                dismissible
                // guardTag: render the dim as the native <sigx-touch-guard>
                // element so the raw Android platform touch can't fall
                // through the dim to a native input underneath (#787).
                backdrop={{ guardTag: TOUCH_GUARD_TAG }}
                dragMode="surface"
                // Reserve the real status bar + header — a hardcoded value
                // slid the fully-open sheet (and its grabber) under the
                // header on tall-inset devices.
                topOffset={(insets.value.top ?? 0) + HEADER_H}
                // The showcase App wraps every screen in a
                // SafeAreaView edges={['top','bottom']}, so this screen's
                // container bottom sits `insets.bottom` above the true
                // screen bottom — without this the cap is anchored wrong
                // and a fling still parks the grabber under the header.
                bottomOffset={insets.value.bottom ?? 0}
                onSnap={(i: number) => { state.lastEvent = `snap → candidate ${i}`; }}
                onDismiss={() => { state.lastEvent = 'dismiss'; state.open = false; }}
                onBackdropTap={() => { state.lastEvent = 'backdropTap'; }}
                class="bg-base-200 rounded-t-2xl"
                slots={{
                    handle: () => (
                        <Col align="center" class="pt-2 pb-3">
                            <view class="w-10 h-1 rounded-full bg-base-300" />
                        </Col>
                    ),
                    default: () => (
                        <ScrollView class="flex-fill">
                            <Col gap={8} padding={{ x: 16, bottom: 24 }}>
                                {Array.from({ length: 40 }, (_, i) => (
                                    <Text key={i} class="text-sm py-1">
                                        {`Row ${i + 1} — scrolls at the top detent, drags the sheet below it`}
                                    </Text>
                                ))}
                            </Col>
                        </ScrollView>
                    ),
                }}
            />
        </view>
    );
});
