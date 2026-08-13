/**
 * The accessibility mapping — zero's ARIA guarantees projected onto lynx's
 * five-prop native surface (`accessibility-element`, `-label`, `-role`,
 * `-trait`, `-status`). There is no ARIA implementation on native lynx: no
 * `aria-expanded` semantics, no live regions, no roving focus. What the
 * platform CAN say is which node is an accessible element, what it is called,
 * what it behaves as, and what state it is in — so that is what every
 * interactive part states, on the node that owns the tap handler (the
 * platform convention, e.g. lynx-navigation's Header/TabBar).
 *
 * The mapping is one function rather than per-component spellings so a
 * screen-reader pass has ONE place to fix.
 */

/** What lynx can express about an interactive part's accessible state. */
export interface PartA11yOptions {
    /** The trait the element behaves as (`button`, `image`, `header`, …). */
    trait?: string;
    /** Accessible name. Required wherever the visible content is not text. */
    label?: string;
    /**
     * State the reader announces. Composed into `accessibility-status` in a
     * stable order — checked/selected before disabled, matching how native
     * readers phrase it.
     */
    checked?: boolean;
    selected?: boolean;
    disabled?: boolean;
}

/** The spreadable accessibility props for the gesture-owning node. */
export function partA11y(options: PartA11yOptions): Record<string, unknown> {
    const props: Record<string, unknown> = {
        'accessibility-element': true,
    };
    if (options.trait) props['accessibility-trait'] = options.trait;
    if (options.label) props['accessibility-label'] = options.label;
    const status: string[] = [];
    if (options.checked !== undefined) status.push(options.checked ? 'checked' : 'unchecked');
    if (options.selected) status.push('selected');
    if (options.disabled) status.push('disabled');
    if (status.length > 0) props['accessibility-status'] = status.join(', ');
    return props;
}
