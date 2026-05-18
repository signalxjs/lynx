import type { RouteId, RouteSearch } from '../register';
import { useNav } from './use-nav';

/**
 * Read the typed search/query params for the current screen, asserted against
 * the named route from the registry.
 *
 * Returns the current entry's search snapshot. See `useParams` for the
 * reactivity story — each navigation triggers a remount via the entry-keyed
 * Stack, so a setup-time snapshot is sufficient.
 */
export function useSearch<K extends RouteId>(_name: K): RouteSearch<K> {
    const nav = useNav();
    return nav.current.search as RouteSearch<K>;
}
