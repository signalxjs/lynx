import { component, signal } from '@sigx/lynx';
import { register, waitForFlush } from '@sigx/lynx-runtime';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Row } from '@sigx/lynx-daisyui';

/**
 * #620 SPIKE screen — throwaway, never for merge.
 *
 * Renders a <list> with NO children and a `spike-snapshot-rows` marker attr.
 * The MT runtime (spike-snapshot.ts) intercepts the attr, synthesizes the
 * update-list-info manifest, and builds every pulled cell synchronously on
 * the main thread via direct PAPI calls. Results stream back over the
 * PublishEvent bridge to the handler registered below and land in the BG
 * console (visible in logcat / dev logs) plus the on-screen tail.
 */

const BASE = [
    '😀', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😉', '😊',
    '😍', '😘', '😜', '🤔', '😐', '😴', '🤯', '😎', '🥳', '😤',
    '👍', '👏', '🙌', '💪', '🐶', '🐱', '🦊', '🍕', '⚽', '🚀',
];
const GLYPHS = Array.from({ length: 1900 }, (_, i) => BASE[i % BASE.length]);

type Variant = 'full' | 'bare' | 'styled' | 'a11y' | 'classy' | 'sigxtext' | 'sweep';
const VARIANTS: Variant[] = ['full', 'sweep'];

export const SnapshotSpikeScreen = component(() => {
    const lines = signal<string[]>([]);
    const variant = signal<Variant>('full');
    const run = signal(0);

    const reportSign = register((data) => {
        const msg = JSON.stringify(data);
        console.log('[620-spike]', msg);
        lines.$set([...lines.slice(-11), msg]);
    });

    // Render-STABLE payload objects (one per variant). A fresh object literal
    // in render would re-emit SET_PROP on every report-driven re-render,
    // re-triggering the MT warm loops in an infinite loop.
    const showGrid = signal(false);
    const warm = signal(0);

    // warmLoops: [] — entry must be instant; warm runs are button-triggered
    // (each remounts the list via the key, re-noting the marker attr).
    const payloads = Object.fromEntries(VARIANTS.map((v) => [
        v,
        { glyphs: GLYPHS, reportSign, variant: v, warmLoops: [] },
    ])) as Record<Variant, Record<string, unknown>>;
    const warmPayloads = Object.fromEntries(VARIANTS.map((v) => [
        v,
        { glyphs: GLYPHS, reportSign, variant: v, warmLoops: [500, 500, 1900] },
    ])) as Record<Variant, Record<string, unknown>>;

    // Same-device OP-PATH baseline: render N cells of the same shape through
    // the normal BG → op-stream → MT pipeline and time set-signal → MT ack.
    const opCells = signal(0);
    function pushLine(msg: string): void {
        console.log('[620-spike]', msg);
        lines.$set([...lines.slice(-11), msg]);
    }
    async function runOpBaseline(n: number): Promise<void> {
        try {
            pushLine(`{"kind":"op-start","cells":${n}}`);
            opCells.value = 0;
            await new Promise((r) => setTimeout(r, 50));
            await waitForFlush();
            const t0 = Date.now();
            opCells.value = n;
            // Render effects run on microtasks; a macrotask boundary guarantees
            // the ops batch has been sent before we await the MT ack.
            await new Promise((r) => setTimeout(r, 0));
            await waitForFlush();
            const total = Date.now() - t0;
            pushLine(JSON.stringify({
                kind: 'op-path',
                cells: n,
                totalMs: total,
                msPerCell: total / n,
            }));
        } catch (e) {
            pushLine(JSON.stringify({ kind: 'op-error', error: String(e) }));
        }
    }

    return () => (
        <view
            class="flex-fill bg-base-100"
            style={{ display: 'flex', flexDirection: 'column' }}
        >
            <Screen title="620 Spike" />
            <Row gap={8} padding={8} wrap>
                {VARIANTS.map((v) => (
                    <Button
                        key={v}
                        size="sm"
                        color={variant.value === v ? 'primary' : 'neutral'}
                        variant="outline"
                        onPress={() => {
                            variant.value = v;
                            lines.$set([]);
                            run.value++;
                        }}
                    >
                        {v}
                    </Button>
                ))}
                <Button
                    size="sm"
                    color="secondary"
                    variant="outline"
                    onPress={() => void runOpBaseline(500)}
                >
                    op500
                </Button>
                <Button
                    size="sm"
                    color="accent"
                    variant="outline"
                    onPress={() => {
                        warm.value++;
                        showGrid.value = true;
                        run.value++;
                    }}
                >
                    warm
                </Button>
                <Button
                    size="sm"
                    color="neutral"
                    variant="outline"
                    onPress={() => {
                        showGrid.value = !showGrid.value;
                        warm.value = 0;
                        run.value++;
                    }}
                >
                    grid
                </Button>
            </Row>
            {/* Op-path baseline target: bounded 1px container, same cell shape. */}
            <view style={{ height: '1px', overflow: 'hidden' }}>
                {Array.from({ length: opCells.value }, (_, i) => (
                    <view
                        key={i}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            paddingTop: '6px',
                            paddingBottom: '6px',
                        }}
                        accessibility-element={true}
                        accessibility-label={BASE[i % BASE.length]}
                        accessibility-trait="button"
                        bindtap={() => {}}
                    >
                        <text style={{ fontSize: 26 }}>{BASE[i % BASE.length]}</text>
                    </view>
                ))}
            </view>
            <view style={{ height: '190px', overflow: 'hidden', padding: '4px' }}>
                {lines.map((l, i) => (
                    <text key={i} style={{ fontSize: '9px' }}>{l}</text>
                ))}
            </view>
            {showGrid.value
                ? (
                    <list
                        key={`spike-${run.value}-${variant.value}`}
                        style={{ height: '1200px', width: '100%' }}
                        scroll-orientation="vertical"
                        list-type="flow"
                        span-count={4}
                        {...({
                            'spike-snapshot-rows': warm.value > 0
                                ? warmPayloads[variant.value as Variant]
                                : payloads[variant.value as Variant],
                        } as Record<string, unknown>)}
                    />
                )
                : null}
        </view>
    );
});
