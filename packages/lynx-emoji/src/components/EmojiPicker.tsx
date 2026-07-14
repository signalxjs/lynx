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

// Module scope so its identity is stable across renders: the grid's render
// reads `props.style`, so a fresh inline literal here would re-run it — and
// re-map every windowed cell — on every picker re-render (each popover
// toggle, each search keystroke).
const GRID_STYLE: Record<string, string | number> = { flexGrow: 1, flexShrink: 1 };

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
    // Split signals: the grid's slice depends on `tab`, the popover overlay
    // on `popover.datum` — keeping them apart (and the grid's props
    // identity-stable, see GRID_STYLE) means toggling the popover leaves the
    // mounted grid untouched.
    const tab = signal(ctx.data.categories[0]?.key ?? 'recents');
    const popover = signal<{ datum: EmojiDatum | null }>({ datum: null });

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
        const emojis = q !== ''
            ? ctx.index.search(q)
            : tab.value === 'recents'
                ? ctx.recents.recents.map((e) => e)
                : byCategory.get(tab.value) ?? [];

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
                        onSelect={(t) => {
                            tab.value = t === 'recents' ? 'recents' : t.key;
                            popover.datum = null;
                        }}
                    />
                )}
                {emojis.length === 0
                    ? (
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
                                {props.emptyLabel
                                    ?? (tab.value === 'recents' && q === '' ? 'No recent emoji yet' : 'No emoji found')}
                            </text>
                        </view>
                    )
                    : (
                        <EmojiGrid
                            emojis={emojis}
                            itemsKey={q !== '' ? 'q:' + q : 't:' + tab.value}
                            tone={tone}
                            columns={props.columns}
                            cellSize={props.cellSize}
                            class={classes.grid}
                            cellClass={classes.cell}
                            renderCell={props.renderCell}
                            style={GRID_STYLE}
                            onPick={(datum) => pick(datum, ctx.skinTone.state.tone)}
                            onPickTone={(datum) => { popover.datum = datum; }}
                        />
                    )}
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
