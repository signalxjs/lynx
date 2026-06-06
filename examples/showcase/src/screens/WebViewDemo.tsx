import {
    component,
    runOnBackground,
    signal,
    useMainThreadRef,
    type MainThread,
} from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Row, Text } from '@sigx/lynx-daisyui';
import { WebView } from '@sigx/lynx-webview';

/**
 * WebView — an embedded browser surface via @sigx/lynx-webview, with a
 * toolbar exercising the imperative methods (`goBack`, `goForward`,
 * `reload`) and load/error state surfaced as signals.
 *
 * The WebView is a direct sibling of the toolbar (not wrapped in an extra
 * `<view class="flex-1">`) — Lynx's layout doesn't propagate a content-size
 * hint up from custom UIs the way it does for built-in `<view>` elements,
 * so wrapping leaves the WebView with zero height.
 */
export const WebViewDemo = component(() => {
    const loading = signal(true);
    const errorMessage = signal<string | null>(null);
    const webRef = useMainThreadRef<MainThread.Element | null>(null);

    return () => {
        // Inline `.invoke()` instead of `WebViewMethods.*` — the
        // `'main thread'` directive compiles these handlers into a separate
        // MT bundle which can't reach cross-package imports.
        // Back/forward only clear a stale error — they may be no-ops with no
        // history, in which case no load event would ever clear a spinner.
        // Reload always fires onLoad/onError, so it can safely re-arm the
        // loading overlay. Signal writes hop to BG via runOnBackground.
        const onBack = () => {
            'main thread';
            runOnBackground(() => { errorMessage.value = null; })();
            webRef.current?.invoke('goBack', {});
        };
        const onForward = () => {
            'main thread';
            runOnBackground(() => { errorMessage.value = null; })();
            webRef.current?.invoke('goForward', {});
        };
        const onReload = () => {
            'main thread';
            runOnBackground(() => {
                loading.value = true;
                errorMessage.value = null;
            })();
            webRef.current?.invoke('reload', {});
        };

        return (
            <view class="flex-fill bg-base-100">
                <Screen title="WebView" />

                <WebView
                    mtRef={webRef}
                    src="https://en.wikipedia.org/wiki/Lynx"
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
                                // top: 0 — the persistent NavHeader lives on the
                                // Stack outside this screen layer, so screen
                                // coordinates already start below it.
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 60,
                            }}
                        >
                            <Text class="opacity-60">Loading…</Text>
                        </view>
                    )
                    : null}

                {errorMessage.value
                    ? (
                        <view
                            class="bg-error/10 items-center justify-center px-6"
                            style={{
                                // top: 0 — the persistent NavHeader lives on the
                                // Stack outside this screen layer, so screen
                                // coordinates already start below it.
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 60,
                            }}
                        >
                            <Text class="text-error">{errorMessage.value}</Text>
                        </view>
                    )
                    : null}

                {/* Toolbar — bare `<view main-thread:bindtap=…>` because
                    `main-thread:bindtap` is a Lynx JSX intrinsic that only
                    binds on raw elements; daisyui's `<Button>` exposes
                    `onPress` (a BG-thread callback) and silently drops
                    arbitrary attributes like `main-thread:bindtap`. */}
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
