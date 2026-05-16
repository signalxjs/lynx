/**
 * `<Header>` — default navigator header chrome.
 *
 * Reads from the currently-focused entry's `ScreenRegistry`:
 *
 *   - If `slots.header` is set, render that (full override).
 *   - Else render the default layout: headerLeft (back button when
 *     `nav.canGoBack`), title (from `options.title`, or the route name as
 *     a fallback), headerRight.
 *
 * Persistent: the Header component itself is mounted once near the root and
 * stays mounted across navigations — it reactively switches its content
 * when `nav.current` changes, rather than being remounted per screen. That
 * matters because mounting cost adds to perceived transition latency.
 *
 * Header chrome is opt-in. Consumers place `<Header />` inside
 * `<NavigationRoot>` above `<Stack />`. We don't auto-inject because:
 *   - app shells vary (some want the header inside a `<SafeArea>`, some
 *     want a custom toolbar, some want no header at all in tabs).
 *   - making it opt-in keeps `<Stack>`'s contract narrow.
 */
import { component, computed } from '@sigx/lynx';
import { useNav } from '../hooks/use-nav.js';
import { useNavInternals } from '../hooks/use-nav-internal.js';
import type { ScreenOptions, ScreenSlotFills, StackEntry } from '../types.js';

/**
 * Resolve a title (string or getter) to a plain string.
 *
 * Getter is the more general case; the `<Screen title={() => state.value}>`
 * call site is how reactive titles work. A plain string is wrapped in a
 * trivial closure so consumers always handle one shape.
 */
function resolveTitle(t: ScreenOptions['title'], routeName: string): string {
    if (typeof t === 'function') return t();
    if (typeof t === 'string') return t;
    return routeName;
}

/**
 * Default back-button rendering. Plain `<text>` with a tap handler — apps
 * that want an icon or a custom design override via
 * `<Screen.HeaderLeft>`. Kept minimal because there's no shared icon
 * primitive at the navigation layer.
 */
const DefaultBackButton = component<{ onPress: () => void } & {}>(({ props }) => {
    return () => (
        <view bindtap={() => props.onPress()}>
            <text>‹ Back</text>
        </view>
    );
});

const DefaultTitle = component<{ text: string } & {}>(({ props }) => {
    return () => (
        <view>
            <text>{props.text}</text>
        </view>
    );
});

/**
 * Persistent header chrome. Mount once above `<Stack>`; reactively follows
 * the focused entry. No props in v1 — styling is a host-app concern,
 * arrived at through the slot fills.
 */
export const Header = component(() => {
    const nav = useNav();
    const internals = useNavInternals();

    // Snapshot computeds — each one reads only what it needs so the header
    // doesn't re-run wholesale on every signal touch. The slot-fill thunks
    // captured by `<Screen.Header>` etc. are themselves reactive (they
    // execute on every render of the consumer's tree), so re-running the
    // outer template is enough to pick up downstream updates.
    const currentEntry = computed<StackEntry>(() => nav.current);

    const headerSlot = computed<ScreenSlotFills['header'] | undefined>(() => {
        const reg = internals.screens.get(currentEntry.value.key);
        return reg?.slots.header;
    });
    const headerLeftSlot = computed<ScreenSlotFills['headerLeft'] | undefined>(() => {
        const reg = internals.screens.get(currentEntry.value.key);
        return reg?.slots.headerLeft;
    });
    const headerRightSlot = computed<ScreenSlotFills['headerRight'] | undefined>(() => {
        const reg = internals.screens.get(currentEntry.value.key);
        return reg?.slots.headerRight;
    });
    const headerShown = computed<boolean>(() => {
        const reg = internals.screens.get(currentEntry.value.key);
        // Default true — most screens want a header. Opting out is one prop
        // on `<Screen>`.
        return reg?.options.headerShown !== false;
    });
    const titleText = computed<string>(() => {
        const reg = internals.screens.get(currentEntry.value.key);
        return resolveTitle(reg?.options.title, currentEntry.value.route);
    });

    return () => {
        if (!headerShown.value) return null;
        // Full-override path: `<Screen.Header>` supplied its own content,
        // we render that and skip the default layout entirely.
        const override = headerSlot.value;
        if (override) return override();

        return (
            <view>
                <view>
                    {headerLeftSlot.value
                        ? headerLeftSlot.value()
                        : nav.canGoBack
                            ? <DefaultBackButton onPress={() => nav.pop()} />
                            : null}
                </view>
                <DefaultTitle text={titleText.value} />
                <view>
                    {headerRightSlot.value ? headerRightSlot.value() : null}
                </view>
            </view>
        );
    };
});
