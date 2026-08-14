/**
 * Runtime tests for `<SwiperIndicator>` — index-only mode (#211) and the
 * offset-driven mode it must not regress.
 *
 * The per-frame dot animation runs through MT mappers
 * (`useSwiperDot*` hooks), which the BG harness can't advance — these
 * tests assert the structural contract: which variants render (vs the
 * pre-#211 behavior of returning `null` without `offset`/`pageWidth`),
 * and that the numbered variant tracks the index signal.
 */
import { describe, expect, it } from 'vitest';
import { signal, useSharedValue, component } from '@sigx/lynx';
import { render, act } from '@sigx/lynx-testing';
import { SwiperIndicator } from '../src/components/SwiperIndicator';

/**
 * Count the dot views in the wrapper row. Each `<Dot>` contributes a
 * `#comment` component anchor alongside its `view`, so filter by type.
 */
function countDots(container: any): number {
    // container → indicator wrapper view (flex row) → dots
    const row = container.children[0];
    return row.children.filter((c: any) => c.type === 'view').length;
}

describe('<SwiperIndicator> index-only mode', () => {
    it('renders animated variants from index alone (previously null)', () => {
        for (const variant of ['dots', 'pill', 'scale-pulse'] as const) {
            const result = render(
                <SwiperIndicator variant={variant} count={4} index={signal(1)} />,
            );
            expect(countDots(result.container)).toBe(4);
            result.unmount();
        }
    });

    it('renders the bar variant from index alone', () => {
        const result = render(
            <SwiperIndicator variant="bar" count={3} index={signal(0)} />,
        );
        // Bar renders a track view (with the sliding thumb inside).
        expect(result.container.children.length).toBeGreaterThan(0);
        result.unmount();
    });

    it('still renders nothing with neither offset nor index', () => {
        const result = render(<SwiperIndicator variant="dots" count={3} />);
        // A null render leaves only the component's #comment anchor.
        const views = result.container.children.filter((c: any) => c.type === 'view');
        expect(views.length).toBe(0);
        result.unmount();
    });
});

describe('<SwiperIndicator> offset-driven mode (regression)', () => {
    it('renders dots when offset + pageWidth are wired', () => {
        const Host = component(() => {
            const offset = useSharedValue(0);
            return () => (
                <SwiperIndicator
                    variant="dots"
                    offset={offset}
                    pageWidth={240}
                    count={5}
                    index={signal(0)}
                />
            );
        });
        const result = render(<Host />);
        expect(countDots(result.container)).toBe(5);
        result.unmount();
    });
});

describe('<SwiperIndicator> numbered variant', () => {
    it('tracks the index signal reactively', () => {
        const index = signal(0);
        const result = render(
            <SwiperIndicator variant="numbered" count={3} index={index} />,
        );
        expect(result.container.textContent()).toBe('1 / 3');
        act(() => { index.value = 2; });
        expect(result.container.textContent()).toBe('3 / 3');
        result.unmount();
    });
});
