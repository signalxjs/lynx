import { component, type Define } from '@sigx/lynx';

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
 */
export const SectionHeader = component<SectionHeaderProps>(({ props }) => {
    return () => (
        <list-item
            item-key={props.itemKey}
            item-type="emoji-header"
            full-span={true}
            sticky-top={true}
            estimated-main-axis-size-px={HEADER_PX}
            class={props.class}
            style={props.class ? undefined : {
                display: 'flex',
                alignItems: 'center',
                height: `${HEADER_PX}px`,
                paddingLeft: '12px',
            }}
        >
            <text
                text={props.label}
                style={{ fontSize: '12px', opacity: 0.55 }}
            />
        </list-item>
    );
});
