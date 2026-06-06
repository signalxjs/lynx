import { component, type Define } from '@sigx/lynx';

export type SearchInputProps =
    & Define.Prop<'placeholder', string, false>
    & Define.Prop<'class', string, false>
    & Define.Model<string>;

const FALLBACK_STYLE = {
    borderRadius: '8px',
    borderWidth: '1px',
    borderColor: 'rgba(127, 127, 127, 0.32)',
    paddingLeft: '10px',
    paddingRight: '10px',
    height: '34px',
} as const;

/**
 * The headless search field — a bare `<input>` two-way bound to the query.
 * Themes restyle via `class` (the neutral border/padding fallback applies
 * only when no class is given) or replace the whole row with the picker's
 * `renderSearchInput`.
 */
export const SearchInput = component<SearchInputProps>(({ props }) => {
    return () => (
        <input
            class={props.class}
            placeholder={props.placeholder ?? 'Search emoji'}
            type="text"
            confirm-type="search"
            model={props.model}
            style={props.class ? undefined : FALLBACK_STYLE}
        />
    );
});
