import { component, type Define, type JSXElement } from '@sigx/lynx';

/**
 * Header row height (px) — the fixed value the sectioned grid's scroll-offset
 * math AND the native size estimate share, so section jumps land exactly.
 */
export const HEADER_PX = 28;

export type SectionHeaderProps =
    & Define.Prop<'label', string, true>
    /** Unique `item-key` within the list (the grid passes `hdr:<sectionKey>`). */
    & Define.Prop<'itemKey', string, true>
    & Define.Prop<'class', string, false>;

/**
 * A category header row for the sectioned picker — a full-span, sticky-top
 * `<list-item>` snapshot template. Zero-slot (the label rides the `text`
 * ATTRIBUTE, like the glyph cell — a child expression would compile to a slot
 * and make headers unpoolable), so headers recycle through their own
 * `emoji-header` pool.
 *
 * Headless: the fallback is a small dim uppercase-ish label with NO background
 * — content scrolls visibly underneath the pinned header until a themed
 * `classes.sectionHeader` provides one (the daisyui wrapper does).
 *
 * The HEIGHT is pinned inline regardless of `class`: `HEADER_PX` is what the
 * native size estimate AND the sectioned grid's scroll-offset math assume, so
 * a theme that changed the real height would land every section jump and
 * tab-follow boundary off target. Theme colors/padding, not height.
 */
/**
 * The header as a PLAIN template row — no component instance (see
 * `emojiCellRow` for why: per-row component instances dominated the
 * sectioned mount, #666). The `SectionHeader` component below wraps this
 * for external composition.
 */
export function sectionHeaderRow(args: { itemKey: string; label: string; class?: string }): JSXElement {
    return (
        <list-item
            item-key={args.itemKey}
            item-type="emoji-header"
            full-span={true}
            sticky-top={true}
            estimated-main-axis-size-px={HEADER_PX}
            class={args.class}
            style={args.class
                ? { height: `${HEADER_PX}px` }
                : {
                    display: 'flex',
                    alignItems: 'center',
                    height: `${HEADER_PX}px`,
                    paddingLeft: '12px',
                }}
        >
            <text
                text={args.label}
                style={{ fontSize: '13px', opacity: 0.55 }}
            />
        </list-item>
    );
}

export const SectionHeader = component<SectionHeaderProps>(({ props }) => {
    return () => sectionHeaderRow({ itemKey: props.itemKey, label: props.label, class: props.class });
});
