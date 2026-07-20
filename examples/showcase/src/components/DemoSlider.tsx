import { component, effect, useSharedValue, type Define } from '@sigx/lynx';
import { Draggable } from '@sigx/lynx-gestures';
import { Col, Row, Text } from '@sigx/lynx-daisyui';

// Fixed track geometry so no layout measurement is needed — the thumb's
// Draggable bounds and the value math share the same constants.
const TRACK_W = 240;
const THUMB = 28;
const RANGE = TRACK_W - THUMB;

export type DemoSliderProps =
    & Define.Prop<'label', string, true>
    & Define.Prop<'min', number, true>
    & Define.Prop<'max', number, true>
    & Define.Prop<'initial', number, true>
    /** Decimal places for the live value readout. Default 0. */
    & Define.Prop<'decimals', number, false>
    & Define.Event<'change', number>;

/**
 * Labeled horizontal slider built from `<Draggable axis="x">` + an external
 * SharedValue — itself a demo of Draggable as a building block (daisyui has
 * no slider component). The thumb position is MT-driven; the value readout
 * reads the SharedValue's reactive BG mirror, so it tracks the finger live
 * through the AV bridge.
 *
 * `change` fires **continuously** while dragging, not just on release: an
 * effect on the SharedValue's BG mirror re-emits every frame the thumb moves,
 * so consumers get instant feedback. The mirror already updates each frame
 * (it drives the readout), so this reuses that stream — no per-frame
 * worklet→BG hop of our own.
 */
export const DemoSlider = component<DemoSliderProps>(({ props, emit }) => {
    const span = props.max - props.min;
    const toX = (v: number): number => ((v - props.min) / span) * RANGE;
    const toValue = (x: number): number => props.min + (x / RANGE) * span;

    const tx = useSharedValue(toX(props.initial));
    const decimals = props.decimals ?? 0;

    // Live-emit the value off the thumb's BG mirror. Skip the initial run —
    // the parent already seeds itself from `initial`, so only user-driven
    // movement should fire `change`. emit() never writes back to `tx`, so
    // there's no feedback loop.
    let primed = false;
    effect(() => {
        const v = toValue(tx.value);
        if (!primed) { primed = true; return; }
        emit('change', v);
    });

    return () => (
        <Col gap={4}>
            <Row justify="space-between" align="center" width={TRACK_W}>
                <Text class="text-sm">{props.label}</Text>
                <Text class="text-sm opacity-60">{toValue(tx.value).toFixed(decimals)}</Text>
            </Row>
            <view style={{ width: `${TRACK_W}px`, height: `${THUMB}px`, justifyContent: 'center' }}>
                <view
                    class="bg-base-300"
                    style={{
                        position: 'absolute',
                        left: '0',
                        right: '0',
                        top: `${(THUMB - 4) / 2}px`,
                        height: '4px',
                        borderRadius: '2px',
                    }}
                />
                <Draggable
                    axis="x"
                    minX={0}
                    maxX={RANGE}
                    translateX={tx}
                >
                    <view
                        class="bg-primary"
                        style={{
                            width: `${THUMB}px`,
                            height: `${THUMB}px`,
                            borderRadius: `${THUMB / 2}px`,
                        }}
                    />
                </Draggable>
            </view>
        </Col>
    );
});
