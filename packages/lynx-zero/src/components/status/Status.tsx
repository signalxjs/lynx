/**
 * Status — a tiny presence dot, zero's `status` anatomy on lynx.
 *
 * ```tsx
 * <Row gap={6} align="center"><Status color="success" /><text>Online</text></Row>
 * <Status color="error" label="Service degraded" />
 * ```
 *
 * One empty `view`: the mark is the skin's paint. No states — "online",
 * "busy" and "degraded" are colours, so they travel on the `color` axis.
 * The accessibility split is zero's:
 *
 * - without `label` the dot decorates visible text that already says what it
 *   means, so it is not an accessible element (announcing both would say
 *   everything twice);
 * - with `label` the dot IS the content: an accessible element with the
 *   `image` trait, named by the label. Never a live region — a static dot
 *   that re-announced itself would be noise.
 */
import type { Define } from '@sigx/lynx';
import { component, compound } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';

const anatomy = anatomies.status;

export type StatusRootProps =
    /** Names the dot when no visible text beside it does (it then announces as an image). */
    & Define.Prop<'label', string, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>;

const StatusRoot = component<StatusRootProps>(({ props }) => {
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color, size: props.size,
    }));
    return () => (
        <view
            {...partBag(anatomy, 'root', { ...partAxes(axes()), class: props.class })}
            {...(props.label
                ? partA11y({ trait: 'image', label: props.label })
                : { 'accessibility-element': false })}
        />
    );
}, { name: 'Status.Root' });

export const Status = compound(StatusRoot, { Root: StatusRoot });
