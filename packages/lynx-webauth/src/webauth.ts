import { callAsync, isModuleAvailable } from '@sigx/lynx-core';

const MODULE = 'WebAuth';

/**
 * Monotonic session id. A plain module-scope counter (no `Math.random` /
 * `Date.now`, which are unavailable in some Lynx BG-thread engines) — it only
 * needs to be unique within a single JS context so `cancelAuthSession` can
 * target the right in-flight session.
 */
let nextSessionId = 0;

export interface OpenAuthSessionOptions {
    /**
     * iOS only. Maps to `ASWebAuthenticationSession.prefersEphemeralWebBrowserSession`
     * — when true the sheet does not share or persist the system browser's
     * cookies, so the user always sees a fresh login (no SSO). Ignored on
     * Android. Defaults to `false`.
     */
    ephemeral?: boolean;
    /**
     * Android only. Chrome Custom Tabs toolbar color as `#RRGGBB`. Ignored on
     * iOS, where the OS controls the sheet chrome.
     */
    toolbarColor?: string;
    /**
     * Android only. Pin a specific Custom Tabs provider by package name (e.g.
     * `"com.android.chrome"`) instead of the user's default browser. Ignored
     * on iOS.
     */
    preferredBrowserPackage?: string;
    /**
     * Abort the in-flight session. Aborting dismisses the iOS sheet (and tears
     * down the pending Android session) and resolves with `{ canceled: true }`.
     * If the signal is already aborted, the call resolves immediately without
     * opening a browser.
     */
    signal?: AbortSignal;
}

/**
 * Result of {@link openAuthSession}. A three-way union discriminated by which
 * field is present:
 *
 *   - `{ url }`            — provider redirected back to `callbackScheme://…`;
 *                            `url` is the full callback URL (parse `code` /
 *                            `state` / `error` yourself, or with
 *                            `parseCallback` from `@sigx/lynx-webauth/oauth`).
 *   - `{ canceled: true }` — user dismissed the sheet, or the session was
 *                            aborted via `options.signal`.
 *   - `{ error }`          — the session could not start or failed.
 */
export type OpenAuthSessionResult =
    | { url: string; canceled?: undefined; error?: undefined }
    | { url?: undefined; canceled: true; error?: undefined }
    | { url?: undefined; canceled?: undefined; error: string };

/**
 * Open a system web-auth session for an OAuth / OpenID-Connect flow.
 *
 * Presents a secure browser sheet *over* the app — `ASWebAuthenticationSession`
 * on iOS, Chrome Custom Tabs on Android — that shares the system browser's
 * cookies (so the user is often already signed in). When the provider redirects
 * to `callbackScheme://…`, the sheet dismisses itself and the callback URL is
 * returned directly here. No global deep-link listener, no foreground polling.
 *
 * Always resolves — cancellation and failures are normal resolved values, never
 * a rejected promise — so call sites don't need a try/catch around the common
 * "user backed out" case.
 *
 * @param authorizeUrl   The provider's authorization URL (with `client_id`,
 *                        `redirect_uri`, `scope`, `state`, PKCE params, …).
 * @param callbackScheme The app's registered custom scheme — the same one Lynx
 *                        wires for `Linking` (set via `signalx.config.ts`'s
 *                        `scheme`). A bare scheme like `"myapp"`; a trailing
 *                        `://` or `:` is tolerated.
 *
 * @example
 * ```ts
 * import { openAuthSession } from '@sigx/lynx-webauth';
 *
 * const result = await openAuthSession(authorizeUrl, 'myapp');
 * if (result.url) {
 *     const code = new URL(result.url).searchParams.get('code');
 *     // exchange `code` for tokens via your backend
 * } else if (result.canceled) {
 *     // user dismissed the sheet
 * } else {
 *     console.error(result.error);
 * }
 * ```
 */
export function openAuthSession(
    authorizeUrl: string,
    callbackScheme: string,
    options: OpenAuthSessionOptions = {},
): Promise<OpenAuthSessionResult> {
    if (typeof authorizeUrl !== 'string' || authorizeUrl.length === 0) {
        return Promise.resolve({ error: 'authorizeUrl is required' });
    }
    if (typeof callbackScheme !== 'string' || callbackScheme.length === 0) {
        return Promise.resolve({ error: 'callbackScheme is required' });
    }
    if (!isModuleAvailable(MODULE)) {
        return Promise.resolve({ error: 'WebAuth module not available in this build' });
    }

    const { signal } = options;
    if (signal?.aborted) {
        return Promise.resolve({ canceled: true });
    }

    const sessionId = `s${nextSessionId++}`;
    const nativeOptions = {
        sessionId,
        authorizeUrl,
        callbackScheme: normalizeScheme(callbackScheme),
        ephemeral: options.ephemeral === true,
        // Pass undefined-free so the native bridge doesn't see null keys.
        ...(options.toolbarColor ? { toolbarColor: options.toolbarColor } : {}),
        ...(options.preferredBrowserPackage
            ? { preferredBrowserPackage: options.preferredBrowserPackage }
            : {}),
    };

    // The openAuthSession callback is the single source of truth for the
    // outcome. `cancelAuthSession` doesn't resolve anything itself — it nudges
    // native to complete *this* session with `{ canceled: true }`.
    const promise = callAsync<unknown>(MODULE, 'openAuthSession', nativeOptions)
        .then(normalizeResult)
        .catch(
            (err: unknown): OpenAuthSessionResult => ({
                error: err instanceof Error ? err.message : String(err),
            }),
        );

    let onAbort: (() => void) | undefined;
    if (signal) {
        onAbort = () => {
            void callAsync(MODULE, 'cancelAuthSession', { sessionId }).catch(() => {});
        };
        signal.addEventListener('abort', onAbort, { once: true });
        // Close the gap between the early aborted-check and listener
        // registration: if it aborted in between, the 'abort' event won't fire
        // again for this listener, so nudge native to cancel now.
        if (signal.aborted) onAbort();
    }

    return promise.finally(() => {
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    });
}

/** Whether the native WebAuth module is wired into the current build. */
export function isWebAuthAvailable(): boolean {
    return isModuleAvailable(MODULE);
}

/** Strip a trailing `://` or `:` so callers can pass `"myapp"`, `"myapp:"`, or `"myapp://"`. */
function normalizeScheme(scheme: string): string {
    return scheme.replace(/:\/\/$/, '').replace(/:$/, '');
}

function normalizeResult(raw: unknown): OpenAuthSessionResult {
    if (raw && typeof raw === 'object') {
        const r = raw as Record<string, unknown>;
        if (typeof r.url === 'string' && r.url.length > 0) return { url: r.url };
        if (r.canceled === true) return { canceled: true };
        if (typeof r.error === 'string' && r.error.length > 0) return { error: r.error };
    }
    return { error: 'Malformed result from WebAuth native module' };
}
