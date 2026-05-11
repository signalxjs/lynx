import { onMounted, onUnmounted } from 'sigx';
import { useRouter } from '@sigx/router';
import { Linking } from './linking.js';
import { parse } from './parse.js';

export interface UseLinkingRouterOptions {
    /**
     * Custom handler for incoming URLs. If provided, the URL is passed through
     * verbatim and the default router-push behaviour is skipped — useful for
     * stripping a known prefix or doing auth-callback work before navigating.
     */
    onURL?: (url: string) => void;
    /**
     * Schemes/prefixes to strip before pushing to the router. Matched in order;
     * the first match wins. Example: `['myapp://', 'https://myapp.com']`
     * lets `https://myapp.com/profile/42` push as `/profile/42`.
     */
    prefixes?: string[];
}

/**
 * Wire incoming deep links into `@sigx/router`. Call once at app root.
 *
 * Handles both cold-start (`getInitialURL`) and warm-start (`addEventListener`)
 * URL delivery, then forwards to `router.push()` as a path+query.
 *
 * @example
 * ```tsx
 * import { useLinkingRouter } from '@sigx/lynx-linking/router';
 *
 * const App = component(() => {
 *     useLinkingRouter({ prefixes: ['myapp://', 'https://myapp.com'] });
 *     return () => <RouterView />;
 * });
 * ```
 */
export function useLinkingRouter(opts: UseLinkingRouterOptions = {}): void {
    const router = useRouter();

    const handle = (url: string): void => {
        if (opts.onURL) {
            opts.onURL(url);
            return;
        }
        const stripped = stripPrefix(url, opts.prefixes);
        if (stripped !== null) {
            router.push(stripped || '/');
            return;
        }
        const { path, queryParams } = parse(url);
        router.push({ path: path || '/', query: queryParams });
    };

    onMounted(() => {
        const initial = Linking.getInitialURL();
        if (initial) handle(initial);
    });

    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    onUnmounted(() => sub.remove());
}

function stripPrefix(url: string, prefixes?: string[]): string | null {
    if (!prefixes || prefixes.length === 0) return null;
    for (const prefix of prefixes) {
        if (url.startsWith(prefix)) {
            const rest = url.slice(prefix.length);
            return rest.startsWith('/') ? rest : `/${rest}`;
        }
    }
    return null;
}
