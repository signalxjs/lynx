import { component, type Define } from '@sigx/lynx';
import './jsx-augment.js';
import type {
    WebViewErrorEvent,
    WebViewLoadEvent,
    WebViewMessageEvent,
} from './jsx-augment.js';

export type WebViewProps =
    & Define.Prop<'src', string, false>
    & Define.Prop<'html', string, false>
    & Define.Prop<'userAgent', string, false>
    & Define.Prop<'debug', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Prop<'style', string | Record<string, string | number>, false>
    & Define.Prop<'onLoad', (e: WebViewLoadEvent) => void, false>
    & Define.Prop<'onError', (e: WebViewErrorEvent) => void, false>
    & Define.Prop<'onMessage', (e: WebViewMessageEvent) => void, false>;

/**
 * Native WebView component.
 *
 * On iOS this wraps a `WKWebView`; on Android, `android.webkit.WebView`.
 * Communication from the page to your app happens via
 * `window.sigx.postMessage(payload)` inside the page — payload is delivered
 * as a string in `event.detail.data` to `onMessage`.
 *
 * @example
 * ```tsx
 * <WebView
 *   src="https://example.com"
 *   onLoad={(e) => console.log('loaded', e.detail.url)}
 *   onError={(e) => console.warn('failed', e.detail.message)}
 *   onMessage={(e) => console.log('page said', e.detail.data)}
 * />
 * ```
 *
 * @remarks
 * Imperative methods (`goBack`, `goForward`, `reload`, `postMessage` to the
 * page, `injectJavaScript`) are not yet implemented — see the package README.
 */
export const WebView = component<WebViewProps>(({ props }) => {
    return () => (
        <sigx-webview
            src={props.src}
            html={props.html}
            user-agent={props.userAgent}
            enable-debug={props.debug}
            class={props.class}
            style={props.style}
            bindload={props.onLoad}
            binderror={props.onError}
            bindmessage={props.onMessage}
        />
    );
});
