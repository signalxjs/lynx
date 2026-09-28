/**
 * Kbd — a keyboard key, zero's `kbd` anatomy on lynx.
 *
 * ```tsx
 * <Row gap={4} align="center">
 *     <Kbd><text>⌘</text></Kbd><Kbd><text>K</text></Kbd>
 * </Row>
 * ```
 *
 * One part, no state, no behavior: the keycap. On the web the substance is
 * the `<kbd>` element; lynx has no such element (and no reader that lists
 * one), so the root is a `view` carrying the axes and the skin's cap paint,
 * and the key's glyph is a `<text>` child — the ink and type size reach it by
 * CSS inheritance. Give `label` when the glyph alone reads badly aloud
 * (`label="Command"` on `⌘`).
 */
import type { Define } from '@sigx/lynx';
import { component, compound } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';

const anatomy = anatomies.kbd;

export type KbdRootProps =
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    /** Accessible name for a glyph that reads badly aloud (`⌘` → "Command"). */
    & Define.Prop<'label', string, false>
    & Define.Slot<'default'>;

const KbdRoot = component<KbdRootProps>(({ props, slots }) => {
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color, size: props.size,
    }));
    return () => (
        <view
            {...partBag(anatomy, 'root', { ...partAxes(axes()), class: props.class })}
            {...(props.label ? partA11y({ label: props.label }) : {})}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Kbd.Root' });

export const Kbd = compound(KbdRoot, { Root: KbdRoot });
