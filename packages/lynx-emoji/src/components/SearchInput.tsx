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
 *
 * The binding is wired manually as a controlled input (`value` +
 * `bindinput`) instead of `model={...}`: this package compiles to snapshot
 * templates, and inside a template an intrinsic element never passes
 * through the jsx-runtime, so the platform model processor that would
 * expand `model` cannot run — the directive would ship to the main thread
 * as a meaningless `model` attribute and the input would never write back.
 */
export const SearchInput = component<SearchInputProps>(({ props }) => {
    const onInput = (e: { detail?: { value?: unknown } }): void => {
        const model = props.model;
        if (model) model.value = String(e?.detail?.value ?? '');
    };

    return () => (
        <input
            class={props.class}
            placeholder={props.placeholder ?? 'Search emoji'}
            type="text"
            confirm-type="search"
            value={props.model?.value ?? ''}
            bindinput={onInput}
            style={props.class ? undefined : FALLBACK_STYLE}
        />
    );
});
