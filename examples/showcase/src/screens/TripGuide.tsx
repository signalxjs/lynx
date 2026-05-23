import {
    component,
    signal,
    useMainThreadRef,
    type MainThread,
} from '@sigx/lynx';
import { Screen, useParams } from '@sigx/lynx-navigation';
import { Button, Col, Row, Text } from '@sigx/lynx-daisyui';
import { Haptics } from '@sigx/lynx-haptics';
import { WebView, WebViewMethods } from '@sigx/lynx-webview';
import { getTrip } from '../store/trips.js';

/**
 * Trip-specific travel guide rendered inside an embedded WebView.
 *
 * Trip names are free-form ("Lisbon, May 2026", "Kyoto, autumn 2025"); the
 * first comma-separated segment is the destination, which we drop into a
 * Wikivoyage URL. Wikivoyage uses underscore-separated page slugs
 * (`New_York_City`, not `New%20York%20City`), so we encode after replacing
 * spaces — that matches how `[[wikilink]]` urls are constructed.
 *
 * This is the real-app integration for `@sigx/lynx-webview` — the Settings
 * card was a throwaway harness. Here the WebView is the screen, with a
 * toolbar exercising the v2 imperative methods (`goBack`, `goForward`,
 * `reload`) so a guide that wandered off into a side article can be
 * navigated without the user having to dismiss the whole screen.
 */
export const TripGuide = component(() => {
    const { tripId } = useParams('tripGuide');
    const loading = signal(true);
    const errorMessage = signal<string | null>(null);
    const webRef = useMainThreadRef<MainThread.Element | null>(null);

    return () => {
        const trip = getTrip(tripId);

        if (!trip) {
            return (
                <view class="flex-fill bg-base-100 p-6">
                    <Screen title="Guide" />
                    <Text class="opacity-60">Trip not found</Text>
                </view>
            );
        }

        const destination = trip.name.split(',')[0]!.trim();
        const slug = encodeURIComponent(destination.replace(/\s+/g, '_'));
        const guideUrl = `https://en.wikivoyage.org/wiki/${slug}`;

        const onBack = () => {
            'main thread';
            WebViewMethods.goBack(webRef.current);
        };
        const onForward = () => {
            'main thread';
            WebViewMethods.goForward(webRef.current);
        };
        const onReload = () => {
            'main thread';
            WebViewMethods.reload(webRef.current);
        };

        return (
            <view class="flex-fill bg-base-100">
                <Screen title={`Guide · ${destination}`} />

                {/* WebView as a direct sibling — mirrors lynx-maps's working
                    layout. Wrapping it in another `<view class="flex-1">`
                    leaves the WebView with zero height (Lynx's layout doesn't
                    propagate a content-size hint up from custom UIs the way
                    it does for built-in `<view>` elements). The overlays
                    sit on top via absolute positioning anchored to the
                    outer flex-fill container. */}
                <WebView
                    mtRef={webRef}
                    src={guideUrl}
                    class="flex-1"
                    onLoad={() => {
                        loading.value = false;
                        errorMessage.value = null;
                    }}
                    onError={(e) => {
                        loading.value = false;
                        errorMessage.value = e.detail.message;
                    }}
                />

                {loading.value
                    ? (
                        <view
                            class="bg-base-100 items-center justify-center"
                            style={{
                                position: 'absolute',
                                top: 56,
                                left: 0,
                                right: 0,
                                bottom: 60,
                            }}
                        >
                            <Text class="opacity-60">
                                Loading Wikivoyage guide for {destination}…
                            </Text>
                        </view>
                    )
                    : null}

                {errorMessage.value
                    ? (
                        <view
                            class="bg-error/10 items-center justify-center px-6"
                            style={{
                                position: 'absolute',
                                top: 56,
                                left: 0,
                                right: 0,
                                bottom: 60,
                            }}
                        >
                            <Col gap={8} align="center">
                                <Text class="text-error">
                                    Couldn't load guide
                                </Text>
                                <Text class="opacity-60 text-sm text-center">
                                    {errorMessage.value}
                                </Text>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    outline
                                    onPress={() => {
                                        Haptics.selection();
                                        errorMessage.value = null;
                                        loading.value = true;
                                        // Schedule on next tick so the loading overlay paints
                                        // before the native reload kicks in.
                                        queueMicrotask(() => {
                                            WebViewMethods.reload(webRef.current);
                                        });
                                    }}
                                >
                                    Retry
                                </Button>
                            </Col>
                        </view>
                    )
                    : null}

                {/* Toolbar — bare `<view main-thread:bindtap=…>` because
                    `main-thread:bindtap` is a Lynx JSX intrinsic that only
                    binds on raw elements; daisyui's `<Button>` exposes
                    `onPress` (a BG-thread callback) and silently drops
                    arbitrary attributes like `main-thread:bindtap`, so the
                    handler would never fire if we used it here. The custom
                    styling below mirrors Button's `variant="ghost" outline`
                    look so the toolbar stays visually consistent. */}
                <view class="bg-base-200 border-t border-base-300 px-4 py-2">
                    <Row gap={8} align="center" justify="center">
                        <view
                            class="border border-base-300 rounded-lg px-3 py-1.5"
                            main-thread:bindtap={onBack}
                            accessibility-element={true}
                            accessibility-label="Go back"
                            accessibility-trait="button"
                        >
                            <Text class="text-sm">‹ Back</Text>
                        </view>
                        <view
                            class="border border-base-300 rounded-lg px-3 py-1.5"
                            main-thread:bindtap={onForward}
                            accessibility-element={true}
                            accessibility-label="Go forward"
                            accessibility-trait="button"
                        >
                            <Text class="text-sm">Forward ›</Text>
                        </view>
                        <view
                            class="border border-base-300 rounded-lg px-3 py-1.5"
                            main-thread:bindtap={onReload}
                            accessibility-element={true}
                            accessibility-label="Reload"
                            accessibility-trait="button"
                        >
                            <Text class="text-sm">↻ Reload</Text>
                        </view>
                    </Row>
                </view>
            </view>
        );
    };
});
