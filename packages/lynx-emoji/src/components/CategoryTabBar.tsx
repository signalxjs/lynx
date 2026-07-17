import { component, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import type { EmojiCategory } from '../data/schema.js';
import type { EmojiRenderCategoryTab, EmojiTab } from '../types.js';

/** A tab plus its representative glyph (🕐 for recents, first emoji otherwise). */
export interface CategoryTabEntry {
    tab: EmojiTab;
    glyph: string;
}

export type CategoryTabBarProps =
    & Define.Prop<'tabs', CategoryTabEntry[], true>
    /** Active tab — a category key, or `'recents'`. */
    & Define.Prop<'active', string, false>
    & Define.Prop<'class', string, false>
    & Define.Prop<'tabClass', string, false>
    & Define.Prop<'tabActiveClass', string, false>
    & Define.Prop<'render', EmojiRenderCategoryTab, false>
    & Define.Event<'select', EmojiTab>;

const ACTIVE_BG = 'rgba(128,128,128,0.25)';

function tabKey(tab: EmojiTab): string {
    return tab === 'recents' ? 'recents' : tab.key;
}

function tabLabel(tab: EmojiTab): string {
    return tab === 'recents' ? 'recents' : tab.label;
}

/**
 * The headless category jump bar — a horizontal row of glyph tabs.
 * Selecting a tab switches which category the grid shows (the picker
 * filters; there is no scroll-position sync to keep headless and cheap).
 */
export const CategoryTabBar = component<CategoryTabBarProps>(({ props, emit }) => {
    return () => (
        <scroll-view scroll-orientation="horizontal" class={props.class}>
            <view style={{ display: 'flex', flexDirection: 'row' }}>
                {props.tabs.map(({ tab, glyph }) => {
                    const key = tabKey(tab);
                    const active = key === props.active;
                    return (
                        <Pressable
                            key={key}
                            class={`${props.tabClass ?? ''}${active && props.tabActiveClass ? ' ' + props.tabActiveClass : ''}`}
                            style={{
                                paddingLeft: '10px',
                                paddingRight: '10px',
                                paddingTop: '6px',
                                paddingBottom: '6px',
                                borderRadius: '8px',
                                ...(active && !props.tabActiveClass ? { backgroundColor: ACTIVE_BG } : {}),
                            }}
                            accessibility-element={true}
                            accessibility-label={tabLabel(tab)}
                            accessibility-trait="button"
                            accessibility-status={active ? 'selected' : undefined}
                            onPress={() => emit('select', tab)}
                        >
                            {props.render
                                ? props.render(tab, glyph, active)
                                : <text style={{ fontSize: 30 }}>{glyph}</text>}
                        </Pressable>
                    );
                })}
            </view>
        </scroll-view>
    );
});

export type { EmojiCategory };
