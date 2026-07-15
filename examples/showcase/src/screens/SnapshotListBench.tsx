import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Row } from '@sigx/lynx-daisyui';

/**
 * Snapshot list bench — a RAW `<list>` of templated `<list-item>` cells
 * (every other list screen goes through @sigx/lynx-list's dist and keeps the
 * per-element path). With `snapshots: true` this exercises #620 phase 5:
 * staged rows, synchronous `componentAtIndex` materialization, and
 * template-keyed recycling. Row churn buttons drive keyed reorders and
 * recycle traffic; the dataset button swaps all cell contents to make
 * re-patch correctness visible (a stale cell would show the old palette).
 */

const COUNT = 2000;
const PALETTES = [
    ['#eef2ff', '#4338ca'],
    ['#ecfdf5', '#047857'],
] as const;

export const SnapshotListBenchScreen = component(() => {
    const palette = signal(0);
    const offset = signal(0);

    return () => {
        const [bg, fg] = PALETTES[palette.value % PALETTES.length];
        const base = offset.value;
        return (
            <view class="flex-fill bg-base-100" style={{ display: 'flex', flexDirection: 'column' }}>
                <Screen title="Snapshot list bench" />
                {/* Fixed-height band: the native list below sizes to a hard
                    main-axis px value and must not bleed into the controls. */}
                <view style={{ height: '64px' }}>
                    <Row gap={8} padding={8}>
                        <Button size="sm" variant="outline" onPress={() => palette.value++}>
                            swap palette
                        </Button>
                        <Button size="sm" variant="outline" onPress={() => offset.value += 7}>
                            shift rows
                        </Button>
                    </Row>
                </view>
                <list
                    style={{ height: '1450px', width: '100%' }}
                    scroll-orientation="vertical"
                    list-type="single"
                    span-count={1}
                >
                    {Array.from({ length: COUNT }, (_, i) => {
                        const n = (i + base) % COUNT;
                        return (
                            <list-item
                                item-key={`row-${n}`}
                                key={`row-${n}`}
                                estimated-main-axis-size-px={56}
                            >
                                <view
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        padding: '8px 16px',
                                        backgroundColor: n % 2 === 0 ? bg : 'transparent',
                                    }}
                                >
                                    <text style={{ fontSize: 16, color: fg }}>
                                        {`#${n} · templated cell`}
                                    </text>
                                </view>
                            </list-item>
                        );
                    })}
                </list>
            </view>
        );
    };
});
