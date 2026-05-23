import { component, type Define, type MainThread, type MainThreadRef } from '@sigx/lynx';
import './jsx-augment.js';
import type {
    WebViewErrorEvent,
    WebViewLoadEvent,
    WebViewMessageEvent,
} from './jsx-augment.js';

/**
 * Ref shape consumers pass via `mtRef` to capture the underlying native
 * element. The current element handle is `ref.current` inside main-thread
 * event handlers — pass it through `WebViewMethods.*` for typed access to
 * `goBack`, `reload`, `injectJavaScript`, etc.
 */
export type WebViewRef = MainThreadRef<MainThread.Element | null>;

export type WebViewProps =
    & Define.Prop<'src', string, false>
    & Define.Prop<'html', string, false>
    & Define.Prop<'userAgent', string, false>
    & Define.Prop<'debug', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Prop<'style', string | Record<string, string | number>, false>
    & Define.Prop<'mtRef', WebViewRef, false>
    & Define.Prop<'onLoad', (e: WebViewLoadEvent) => void, false>
    & Define.Prop<'onError', (e: WebViewErrorEvent) => void, false>
    & Define.Prop<'onMessage', (e: WebViewMessageEvent) => void, false>;

/**
 * Native WebView component.
 *
 * On iOS this wraps a `WKWebView`; on Android, `android.webkit.WebView`.
 *
 * - Page → host: `window.sigx.postMessage(payload)` inside the page surfaces
 *   on `onMessage` as `event.detail.data` (always a string).
 * - Host → page: pass `mtRef` and call `WebViewMethods.postMessage(ref.current, data)`
 *   from a main-thread event handler. The page subscribes by setting
 *   `window.sigx.onmessage = (data) => { … }`.
 *
 * @example
 * ```tsx
 * import { useMainThreadRef, type MainThread } from '@sigx/lynx';
 * import { WebView, WebViewMethods } from '@sigx/lynx-webview';
 *
 * const ref = useMainThreadRef<MainThread.Element | null>(null);
 * const onBack = () => { 'main thread'; WebViewMethods.goBack(ref.current); };
 *
 * <WebView mtRef={ref} src="https://example.com" />
 * <Button onPress={onBack}>Back</Button>
 * ```
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
            main-thread:ref={props.mtRef}
            bindload={props.onLoad}
            binderror={props.onError}
            bindmessage={props.onMessage}
        />
    );
});

/**
 * Typed wrappers around `MainThread.Element.invoke(method, params)` for each
 * v2 imperative method. Lives outside the component so it's directly callable
 * from any main-thread handler without dragging the component closure in.
 *
 * All methods accept `el | null` so call sites can pass `ref.current` directly
 * without nesting an `if`. When `el` is null the call is a no-op (returns
 * `void` synchronously or `Promise<void>`/default value asynchronously).
 *
 * Method semantics mirror the iOS / Android native implementations:
 *
 *   - `goBack` / `goForward` are no-ops when there's no history.
 *   - `reload` always succeeds even on the current document.
 *   - `canGoBack` / `canGoForward` resolve with `false` if the element is
 *     gone.
 *   - `injectJavaScript` returns the last-expression value stringified.
 *     `null` / `undefined` results land as `""`.
 *   - `postMessage` delivers to `window.sigx.onmessage(data)` inside the
 *     page; pages that haven't subscribed get a silent no-op.
 */
// `invoke()` returns a Promise that can reject when the underlying UI method
// rejects (native error, method missing on a stale element, …). For the
// fire-and-forget wrappers below, swallow the rejection so callers don't
// have to wrap every tap handler in try/catch and don't accumulate unhandled
// rejection warnings. For the async getters, catch + fall back to the
// documented default value (`false` / `""`) so the failure mode matches
// the el-is-null mode — callers only have to handle one shape.
function fireAndForget(p: Promise<unknown> | undefined): void {
    p?.catch(() => { /* documented no-op semantics */ });
}

export const WebViewMethods = {
    goBack(el: MainThread.Element | null): void {
        fireAndForget(el?.invoke('goBack', {}));
    },
    goForward(el: MainThread.Element | null): void {
        fireAndForget(el?.invoke('goForward', {}));
    },
    reload(el: MainThread.Element | null): void {
        fireAndForget(el?.invoke('reload', {}));
    },
    stopLoading(el: MainThread.Element | null): void {
        fireAndForget(el?.invoke('stopLoading', {}));
    },
    async canGoBack(el: MainThread.Element | null): Promise<boolean> {
        if (!el) return false;
        try {
            const r = await el.invoke('canGoBack', {}) as { value?: boolean } | undefined;
            return r?.value ?? false;
        } catch {
            return false;
        }
    },
    async canGoForward(el: MainThread.Element | null): Promise<boolean> {
        if (!el) return false;
        try {
            const r = await el.invoke('canGoForward', {}) as { value?: boolean } | undefined;
            return r?.value ?? false;
        } catch {
            return false;
        }
    },
    async injectJavaScript(el: MainThread.Element | null, code: string): Promise<string> {
        if (!el) return '';
        try {
            const r = await el.invoke('injectJavaScript', { code }) as { result?: string } | undefined;
            return r?.result ?? '';
        } catch {
            return '';
        }
    },
    postMessage(el: MainThread.Element | null, data: string): void {
        fireAndForget(el?.invoke('postMessage', { data }));
    },
} as const;
