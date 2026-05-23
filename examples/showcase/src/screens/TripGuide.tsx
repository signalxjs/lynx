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

                <view class="flex-1" style={{ position: 'relative' }}>
                    <WebView
                        mtRef={webRef}
                        src={guideUrl}
                        style={{ width: '100%', height: '100%' }}
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
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
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
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
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
                                                // Synchronous-from-BG reload works because
                                                // WebViewMethods.* swallows the cross-thread cost
                                                // by deferring to the main thread inside invoke.
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
                </view>

                {/* Toolbar — uses MT bindtap so each tap stays on one thread and
                    doesn't pay the BG↔MT round-trip just to call invoke(). */}
                <view class="bg-base-200 border-t border-base-300 px-4 py-2">
                    <Row gap={8} align="center" justify="center">
                        <Button
                            size="sm"
                            variant="ghost"
                            outline
                            main-thread:bindtap={onBack}
                        >
                            ‹ Back
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            outline
                            main-thread:bindtap={onForward}
                        >
                            Forward ›
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            outline
                            main-thread:bindtap={onReload}
                        >
                            ↻ Reload
                        </Button>
                    </Row>
                </view>
            </view>
        );
    };
});
