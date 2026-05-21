import type { RouteId, RouteParams } from '../register.js';
import { useNav } from './use-nav.js';

/**
 * Read the typed params for the current screen, asserted against the named
 * route from the registry.
 *
 * Returns the current entry's params snapshot. The `name` arg is the type
 * discriminator at compile time; we don't currently runtime-check that the
 * caller's route matches the active entry — the dev-mode warning lands in a
 * later slice along with schema validation.
 *
 * **Reactivity**: each `nav.push` / `replace` produces a new entry with a
 * fresh `key`. `<Stack>` keys the rendered component on `entry.key`, so the
 * screen component fully remounts on every navigation — useParams runs again
 * during the new mount and reads the new params. There is no "in-place params
 * update for the same mounted screen" path in v0.1, so a snapshot at setup
 * time is correct.
 */
export function useParams<K extends RouteId>(_name: K): RouteParams<K> {
    const nav = useNav();
    return nav.current.params as RouteParams<K>;
}
