/**
 * Spinner — a busy indicator, and nothing else (zero's `spinner` scope).
 *
 * ```tsx
 * <Spinner />
 * <Spinner label="Uploading" size="lg" color="accent" />
 * <Row gap={8}><Spinner decorative size="sm" /><text>Saving…</text></Row>
 * ```
 *
 * No state: it spins, or it is not rendered. The mark is the skin's, drawn
 * on the root (daisy: a border ring with one coloured quadrant, turned by a
 * keyframe), so the root renders no visible content.
 *
 * The words live in the `label` part as TEXT ("Loading" by default,
 * `label` overrides): a visually hidden `<text>`, kept in the tree for the
 * reader but out of layout and paint. Lynx has no live region, so the root
 * is also one accessible element named by those words and announced as
 * busy. `decorative` is for a spinner beside text that already says it: no
 * label part, and the mark is hidden from the reader.
 */
import type { Define } from '@sigx/lynx';
import { component, compound } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { VISUALLY_HIDDEN } from '../../shared/native-text.js';

const anatomy = anatomies.spinner;

export type SpinnerRootProps =
    /** What the spinner announces (default "Loading"). */
    & Define.Prop<'label', string, false>
    /** Decoration beside text that already says it: no label, hidden from the reader. */
    & Define.Prop<'decorative', boolean, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>;

const SpinnerRoot = component<SpinnerRootProps>(({ props }) => {
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color, size: props.size,
    }));
    return () => {
        const a = axes();
        const bag = partBag(anatomy, 'root', { ...partAxes(a), class: props.class });
        if (props.decorative) {
            return <view {...bag} accessibility-element={false} />;
        }
        const words = props.label ?? 'Loading';
        return (
            <view {...bag} {...partA11y({ label: words })} accessibility-status="busy">
                <text {...partBag(anatomy, 'label', partAxes(a))} style={VISUALLY_HIDDEN}>{words}</text>
            </view>
        );
    };
}, { name: 'Spinner.Root' });

// See Skeleton: single-part scopes still carry `.Root`.
export const Spinner = compound(SpinnerRoot, { Root: SpinnerRoot });
