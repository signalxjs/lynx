import { component, signal, type Define } from '@sigx/lynx';
import type { EmojiData, EmojiDatum, SkinTone } from '../data/schema.js';
import { glyphForTone } from '../data/glyph.js';
import { createEmojiContext, useEmojiContext, type EmojiContextValue } from '../state/context.js';
import type {
    EmojiPickEvent,
    EmojiPropsExtensions,
    EmojiRenderCategoryTab,
    EmojiRenderCell,
    EmojiRenderSearchInput,
    EmojiSlotClasses,
    EmojiTab,
} from '../types.js';
import { CategoryTabBar, type CategoryTabEntry } from './CategoryTabBar.js';
import { EmojiGrid } from './EmojiGrid.js';
import { SearchInput } from './SearchInput.js';
import { SkinTonePopover } from './SkinTonePopover.js';

export type EmojiPickerProps =
    /**
     * Locale dataset. Optional when an `<EmojiProvider>` is in scope (the
     * provider's shared context wins — recents/tone stay in sync across
     * surfaces); required without one. Fixed at mount.
     */
    & Define.Prop<'data', EmojiData, false>
    /** Grid columns. Default 8. */
    & Define.Prop<'columns', number, false>
    /** Show the recents tab. Default true. */
    & Define.Prop<'showRecents', boolean, false>
    /** Show the search row. Default true. */
    & Define.Prop<'showSearch', boolean, false>
    & Define.Prop<'searchPlaceholder', string, false>
    /** Shown when the current slice is empty (no recents yet / no search hits). */
    & Define.Prop<'emptyLabel', string, false>
    /** Glyph font size in grid cells. Default 26. */
    & Define.Prop<'cellSize', number, false>
    /** Per-slot class overrides — the theming surface. */
    & Define.Prop<'classes', EmojiSlotClasses, false>
    & Define.Prop<'class', string, false>
    & Define.Prop<'style', Record<string, string | number>, false>
    & Define.Prop<'renderCell', EmojiRenderCell, false>
    & Define.Prop<'renderCategoryTab', EmojiRenderCategoryTab, false>
    & Define.Prop<'renderSearchInput', EmojiRenderSearchInput, false>
    & EmojiPropsExtensions
    & Define.Event<'pick', EmojiPickEvent>;

const RECENTS_GLYPH = '🕘';

// Style TEMPLATES — spread into per-element objects, never passed directly.
// Two identity constraints pull in opposite directions here: a style object
// must be IDENTITY-STABLE per element across renders (a fresh literal would
// re-run the grid's render — re-mapping every windowed cell — on every
// picker re-render), yet must NOT be one shared instance across sibling
// elements (sharing one object across several elements' style props trips
// the same silent runtime paint bug as sharing a data array across prop
// proxies — signalxjs/lynx#603 — and blanks the whole surface). The
// per-key caches in setup scope below satisfy both.
const GRID_STYLE_TEMPLATE: Record<string, string | number> = { flexGrow: 1, flexShrink: 1 };
const GRID_WRAP_STYLE_TEMPLATE: Record<string, string | number> = {
    flexGrow: 1,
    flexShrink: 1,
    display: 'flex',
    flexDirection: 'column',
};

/**
 * Curated tab icons per CLDR group key. The first-emoji-of-group fallback
 * produces baffling tabs — the activities group literally starts with 🎃
 * (event → jack-o-lantern) and symbols with 🏧 (#254) — so known groups get
 * the icon every mainstream picker uses; unknown keys (future CLDR groups)
 * fall back to their first emoji.
 */
const CATEGORY_GLYPHS: Record<string, string> = {
    'smileys-emotion': '😀',
    'people-body': '👋',
    'animals-nature': '🐻',
    'food-drink': '🍔',
    'travel-places': '🌍',
    'activities': '⚽',
    'objects': '💡',
    'symbols': '🔣',
    'flags': '🚩',
};

/**
 * The headless emoji picker — search row, category tab bar, recycled glyph
 * grid, skin-tone long-press popover, persistent recents. Unstyled beyond
 * neutral fallbacks; theme via `classes`/render props (see `EmojiSlotClasses`)
 * or use a themed wrapper like daisyui's `EmojiPickerSheet`.
 *
 * Sizing: the picker is a flex column that fills its container — give it a
 * bounded height (the wrappers in `../wrappers/` do).
 */
export const EmojiPicker = component<EmojiPickerProps>(({ props, emit }) => {
    const injected = useEmojiContext();
    const local = !injected && props.data ? createEmojiContext(props.data) : null;
    const ctx: EmojiContextValue | null = injected ?? local;
    if (!ctx) {
        throw new Error(
            '[lynx-emoji] EmojiPicker needs a dataset: pass the `data` prop '
            + "(e.g. `import data from '@sigx/lynx-emoji/data/en'`) or mount an <EmojiProvider> above it.",
        );
    }

    // One slice per category, computed once — category switches are lookups.
    const byCategory = new Map<string, EmojiDatum[]>();
    ctx.data.categories.forEach((cat, i) => {
        byCategory.set(cat.key, ctx.data.emojis.filter((e) => e.c === i));
    });

    const tabs: CategoryTabEntry[] = ctx.data.categories.map((cat) => ({
        tab: cat,
        glyph: CATEGORY_GLYPHS[cat.key] ?? byCategory.get(cat.key)?.[0]?.e ?? '❓',
    }));

    const query = signal('');
    // Split signals: the grid's slice depends on `gridTab`, the popover
    // overlay on `popover.datum` — keeping them apart (and the grid's props
    // identity-stable, see GRID_STYLE) means toggling the popover leaves the
    // mounted grid untouched.
    //
    // Tab switches are two-phase: `tab` flips immediately (the tab bar's
    // highlight is a cheap flush that paints right away), `gridTab` follows
    // one tick later — otherwise the highlight and the ~120-cell grid swap
    // share one flush and the selection doesn't show until the grid is
    // built, which reads as lag on the tap itself.
    const initialTab = ctx.data.categories[0]?.key ?? 'recents';
    const tab = signal(initialTab);
    const gridTab = signal(initialTab);
    const popover = signal<{ datum: EmojiDatum | null }>({ datum: null });
    // Recently visited categories keep their grid MOUNTED (hidden via
    // `use:show`, one SET_STYLE op to toggle): a first visit builds its
    // ~120-cell window once, revisiting a still-mounted tab rebuilds zero
    // cells (the native list resets its scroll to the top while hidden,
    // which matches what other pickers do on a category tap).
    //
    // LRU-capped: each kept grid is a live native <list>, and past ~9
    // mounted lists their per-layout page events — dispatched even with no
    // JS consumer — trip the engine's dispatch rate limiter (error 204,
    // "called too frequently"; #606) and the dev overlay red-screens.
    // Keeping the current tab plus the three most recently visited covers
    // the tabs users actually bounce between while staying far below the
    // flood threshold; evicted tabs simply rebuild their window (still
    // windowed, still behind the two-phase highlight) on the next visit.
    const MAX_MOUNTED_GRIDS = 4;
    const visitedTabs = signal<{ keys: string[] }>({ keys: [initialTab] });

    // Per-element style objects, cached per tab key — identity-stable across
    // renders AND unique per element (see the template note above / #603).
    const wrapStyles = new Map<string, Record<string, string | number>>();
    const gridStyles = new Map<string, Record<string, string | number>>();
    const styleFor = (
        cache: Map<string, Record<string, string | number>>,
        template: Record<string, string | number>,
        key: string,
    ): Record<string, string | number> => {
        let style = cache.get(key);
        if (!style) {
            style = { ...template };
            cache.set(key, style);
        }
        return style;
    };

    function selectTab(key: string): void {
        tab.value = key;
        popover.datum = null;
        setTimeout(() => {
            // Stale-tap guard: rapid taps only swap the grid to the final tab.
            if (tab.value !== key) return;
            // LRU bump: move to most-recent, evict past the mounted cap.
            const keys = visitedTabs.keys.filter((k) => k !== key);
            keys.push(key);
            while (keys.length > MAX_MOUNTED_GRIDS) keys.shift();
            visitedTabs.$set({ keys });
            gridTab.value = key;
        }, 0);
    }

    function pick(datum: EmojiDatum, tone: SkinTone): void {
        ctx!.recents.push(datum);
        emit('pick', { datum, glyph: glyphForTone(datum, tone), tone });
    }

    const searchApi = {
        query: () => query.value,
        setQuery: (q: string) => { query.value = q; },
    };

    return () => {
        const classes = props.classes ?? {};
        const showRecents = props.showRecents ?? true;
        const q = query.value.trim();
        const tone = ctx.skinTone.state.tone;

        const allTabs = showRecents
            ? [{ tab: 'recents' as EmojiTab, glyph: RECENTS_GLYPH }, ...tabs]
            : tabs;
        const searchHits = q !== '' ? ctx.index.search(q) : null;
        const sliceFor = (key: string): EmojiDatum[] =>
            key === 'recents' ? ctx.recents.recents.map((e) => e) : byCategory.get(key) ?? [];

        const renderEmpty = (label: string): unknown => (
            <view
                class={classes.empty}
                style={{
                    flexGrow: 1,
                    flexShrink: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <text style={{ fontSize: 14, ...(classes.empty ? {} : { opacity: 0.55 }) }}>
                    {props.emptyLabel ?? label}
                </text>
            </view>
        );

        const renderGrid = (emojis: EmojiDatum[], styleKey: string, itemsKey: string): unknown => (
            <EmojiGrid
                emojis={emojis}
                itemsKey={itemsKey}
                tone={tone}
                columns={props.columns}
                cellSize={props.cellSize}
                class={classes.grid}
                cellClass={classes.cell}
                renderCell={props.renderCell}
                style={styleFor(gridStyles, GRID_STYLE_TEMPLATE, styleKey)}
                onPick={(datum) => pick(datum, ctx.skinTone.state.tone)}
                onPickTone={(datum) => { popover.datum = datum; }}
            />
        );

        return (
            <view
                class={`${classes.root ?? ''}${props.class ? ' ' + props.class : ''}`}
                style={{
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    // NOT the `flex` shorthand — the inline-style path doesn't
                    // expand it on iOS Lynx 3.8 (resolves to 0 height; the
                    // class-based `flex-1` is unaffected).
                    flexGrow: 1,
                    flexShrink: 1,
                    ...props.style,
                }}
            >
                {(props.showSearch ?? true) && (
                    <view class={classes.searchWrap} style={classes.searchWrap ? undefined : { padding: '8px' }}>
                        {props.renderSearchInput
                            ? props.renderSearchInput(searchApi)
                            : (
                                <SearchInput
                                    class={classes.search}
                                    placeholder={props.searchPlaceholder}
                                    model={[query, 'value']}
                                />
                            )}
                    </view>
                )}
                {q === '' && (
                    <CategoryTabBar
                        tabs={allTabs}
                        active={tab.value}
                        class={classes.tabBar}
                        tabClass={classes.tab}
                        tabActiveClass={classes.tabActive}
                        render={props.renderCategoryTab}
                        onSelect={(t) => selectTab(t === 'recents' ? 'recents' : t.key)}
                    />
                )}
                {searchHits !== null
                    ? (searchHits.length === 0
                        ? renderEmpty('No emoji found')
                        : renderGrid(searchHits, 'search', 'q:' + q))
                    // One wrapper per tab, ALWAYS — a constant-shape keyed
                    // array, so mounting one tab's grid never disturbs the
                    // siblings (a growing array re-anchors the whole set).
                    // A wrapper stays empty until its tab is first visited.
                    : allTabs.map((entry) => {
                        const key = entry.tab === 'recents' ? 'recents' : entry.tab.key;
                        const slice = visitedTabs.keys.includes(key) ? sliceFor(key) : null;
                        return (
                            <view
                                key={key}
                                use:show={gridTab.value === key}
                                style={styleFor(wrapStyles, GRID_WRAP_STYLE_TEMPLATE, key)}
                            >
                                {slice !== null && (slice.length === 0
                                    ? renderEmpty(key === 'recents' ? 'No recent emoji yet' : 'No emoji found')
                                    : renderGrid(slice, key, 't:' + key))}
                            </view>
                        );
                    })}
                {popover.datum && (
                    <SkinTonePopover
                        datum={popover.datum}
                        toneLabels={ctx.data.skinTones}
                        activeTone={tone}
                        backdropClass={classes.popoverBackdrop}
                        class={classes.popover}
                        cellClass={classes.popoverCell}
                        onSelect={(t) => {
                            const datum = popover.datum;
                            popover.datum = null;
                            if (!datum) return;
                            ctx.skinTone.set(t);
                            pick(datum, t);
                        }}
                        onClose={() => { popover.datum = null; }}
                    />
                )}
            </view>
        );
    };
});
