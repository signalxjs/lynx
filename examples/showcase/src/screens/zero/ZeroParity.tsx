/**
 * Zero Parity (#1029 B8) — the same daisyUI look from two stacks, side by
 * side on one device:
 *
 *   LEFT  — NEW: zero anatomy + class-grammar CSS compiled from
 *           @sigx/zero-daisyui's recipes (the web's recipe source).
 *   RIGHT — OLD: @sigx/lynx-daisyui's hand-written components + tailwind
 *           preset CSS (on @sigx/lynx-zero-legacy).
 *
 * The two columns should read as the same design system; every visible
 * divergence is a recipe-fidelity bug to file against the zero-daisyui
 * lynx target. This screen (and the old components) retire together with
 * the legacy stack once parity holds.
 */
import '@sigx/lynx-daisyui-zero/css/index.css';
import '@sigx/lynx-daisyui-zero';
import type { Define } from '@sigx/lynx';
import { component } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button as OldButton, Progress as OldProgress, Toggle as OldToggle } from '@sigx/lynx-daisyui';
import { Button, Col, Progress, Row, ScrollView, Switch, ZeroRoot } from '@sigx/lynx-zero';

type PairProps = Define.Prop<'label', string, true> & Define.Slot<'zero'> & Define.Slot<'legacy'>;

const Pair = component<PairProps>(({ props, slots }) => {
    return () => (
        <Col gap={6} style={{ paddingTop: '10px', paddingBottom: '10px' }}>
            <text style={{ fontSize: '13px', fontWeight: 'bold' }}>{props.label}</text>
            <Row gap={12}>
                <view style={{ flexGrow: 1, flexShrink: 1, flexBasis: '0%' }}>{slots.zero?.()}</view>
                <view style={{ flexGrow: 1, flexShrink: 1, flexBasis: '0%' }}>{slots.legacy?.()}</view>
            </Row>
        </Col>
    );
});

export const ZeroParity = component(() => {
    return () => (
        <ZeroRoot>
            <Screen title="Zero Parity" />
            <ScrollView class="flex-fill">
                <Col gap={4} padding={16}>
                    <Row gap={12}>
                        <text style={{ flexGrow: 1, fontSize: '12px', opacity: 0.6 }}>NEW — compiled recipes</text>
                        <text style={{ flexGrow: 1, fontSize: '12px', opacity: 0.6 }}>OLD — hand-written CSS</text>
                    </Row>

                    <Pair
                        label="Button / primary"
                        slots={{
                            zero: () => <Button color="primary"><text>Save</text></Button>,
                            legacy: () => <OldButton color="primary">Save</OldButton>,
                        }}
                    />

                    <Pair
                        label="Button / default"
                        slots={{
                            zero: () => <Button><text>Cancel</text></Button>,
                            legacy: () => <OldButton>Cancel</OldButton>,
                        }}
                    />

                    <Pair
                        label="Switch vs Toggle / checked"
                        slots={{
                            zero: () => <Switch defaultChecked color="primary" label="Wi-Fi" />,
                            legacy: () => <OldToggle checked color="primary" />,
                        }}
                    />

                    <Pair
                        label="Progress / 60%"
                        slots={{
                            zero: () => (
                                <Progress.Root value={60} color="primary">
                                    <Progress.Track><Progress.Range /></Progress.Track>
                                </Progress.Root>
                            ),
                            legacy: () => <OldProgress value={60} max={100} color="primary" />,
                        }}
                    />
                </Col>
            </ScrollView>
        </ZeroRoot>
    );
});
