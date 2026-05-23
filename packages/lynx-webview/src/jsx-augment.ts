/**
 * JSX intrinsic type augmentation for `<sigx-webview>`.
 *
 * Importing this module registers `'sigx-webview'` as a valid JSX intrinsic
 * with the prop + event surface implemented by `SigxWebViewUI` (iOS) and
 * `SigxWebViewUI.kt` (Android). Pulled in automatically by
 * `@sigx/lynx-webview`'s entry point so consumers do not need to import it
 * directly.
 *
 * Element availability requires `sigx prebuild` to have run after adding
 * this package as a dependency — the autolinker emits the `LynxConfig`
 * registration (iOS) and `Behavior` attachment (Android) that bind the tag
 * to the native UI class.
 */
import type { LynxCommonAttributes, LynxEventHandler } from '@sigx/lynx-runtime';

export interface WebViewLoadEventDetail {
    url: string;
    [k: string]: unknown;
}
export interface WebViewLoadEvent {
    type: 'load';
    detail: WebViewLoadEventDetail;
}

export interface WebViewErrorEventDetail {
    url: string;
    message: string;
    [k: string]: unknown;
}
export interface WebViewErrorEvent {
    type: 'error';
    detail: WebViewErrorEventDetail;
}

export interface WebViewMessageEventDetail {
    /**
     * Payload the page sent via `window.sigx.postMessage(payload)`. Always a
     * string on the wire — apps that send JSON should `JSON.parse` here.
     */
    data: string;
    [k: string]: unknown;
}
export interface WebViewMessageEvent {
    type: 'message';
    detail: WebViewMessageEventDetail;
}

export interface SigxWebViewAttributes extends LynxCommonAttributes {
    /** URL to load. Setting both `src` and `html` is undefined behavior — pick one. */
    src?: string;
    /** Inline HTML to render (no network fetch). */
    html?: string;
    /** Override the WebView's User-Agent string. */
    'user-agent'?: string;
    /**
     * Enable platform debugging — Safari Web Inspector on iOS 16.4+,
     * `chrome://inspect` on Android. Note: Android's flag is **process-wide**.
     */
    'enable-debug'?: boolean;
    /** Fires once the main-frame navigation finishes. */
    bindload?: LynxEventHandler<WebViewLoadEvent>;
    /** Fires on main-frame load failure. */
    binderror?: LynxEventHandler<WebViewErrorEvent>;
    /** Fires when the page calls `window.sigx.postMessage(payload)`. */
    bindmessage?: LynxEventHandler<WebViewMessageEvent>;
}

declare global {
    namespace JSX {
        interface IntrinsicElements {
            'sigx-webview': SigxWebViewAttributes;
        }
    }
}

export {};
