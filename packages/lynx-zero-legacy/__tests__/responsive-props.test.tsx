/**
 * End-to-end wiring for per-breakpoint props (#1013): a layout primitive
 * rendered at a phone width vs an iPad width must resolve different values.
 *
 * Core's `useWidthClass()` is a module-level singleton seeded from
 * `lynx.__globalProps.screen`, so each width needs a fresh module graph —
 * hence `vi.resetModules()` + dynamic import, the same shape
 * `packages/lynx-core/__tests__/screen.test.ts` uses.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

function installScreen(width: number, height: number): void {
    (globalThis as { lynx?: unknown }).lynx = {
        __globalProps: {
            screen: {
                width,
                height,
                scale: 2,
                orientation: width > height ? 'landscape-left' : 'portrait',
            },
        },
        getJSModule: () => undefined,
    };
}

/** Render `Col`/`Row` against a fresh module graph seeded at `width`. */
async function atWidth(width: number, height = 1366) {
    vi.resetModules();
    installScreen(width, height);
    const [{ render }, { Col }, { Row }] = await Promise.all([
        import('@sigx/lynx-testing'),
        import('../src/layout/Col'),
        import('../src/layout/Row'),
    ]);
    return { render, Col, Row };
}

const PHONE = 393;    // iPhone 15 Pro portrait  -> compact
const TABLET = 1024;  // iPad Air 13 portrait    -> expanded

afterEach(() => {
    delete (globalThis as { lynx?: unknown }).lynx;
});

describe('responsive props on layout primitives', () => {
    it('resolves padding per breakpoint', async () => {
        {
            const { render, Col } = await atWidth(PHONE);
            const { container } = render(
                <Col padding={{ initial: 16, expanded: 32 }}><text>A</text></Col>,
            );
            expect(container.children[0]._style.paddingTop).toBe(16);
        }
        {
            const { render, Col } = await atWidth(TABLET);
            const { container } = render(
                <Col padding={{ initial: 16, expanded: 32 }}><text>A</text></Col>,
            );
            expect(container.children[0]._style.paddingTop).toBe(32);
        }
    });

    it('resolves gap per breakpoint', async () => {
        const { render, Col } = await atWidth(TABLET);
        const { container } = render(
            <Col gap={{ initial: 8, expanded: 24 }}><text>A</text></Col>,
        );
        expect(container.children[0]._style.gap).toBe(24);
    });

    it('flips the main axis without swapping the component', async () => {
        // The reason `direction` exists: `{wide ? <Row/> : <Col/>}` would
        // change the component type and remount the whole subtree on rotation.
        {
            const { render, Col } = await atWidth(PHONE);
            const { container } = render(
                <Col direction={{ initial: 'column', expanded: 'row' }}><text>A</text></Col>,
            );
            expect(container.children[0]._style.flexDirection).toBe('column');
        }
        {
            const { render, Col } = await atWidth(TABLET);
            const { container } = render(
                <Col direction={{ initial: 'column', expanded: 'row' }}><text>A</text></Col>,
            );
            expect(container.children[0]._style.flexDirection).toBe('row');
        }
    });

    it('keeps each primitive its namesake axis by default', async () => {
        const { render, Col, Row } = await atWidth(TABLET);
        expect(render(<Col><text>A</text></Col>)
            .container.children[0]._style.flexDirection).toBe('column');
        expect(render(<Row><text>A</text></Row>)
            .container.children[0]._style.flexDirection).toBe('row');
    });

    it('omits a prop whose narrowest key is above the active class', async () => {
        const { render, Col } = await atWidth(PHONE);
        const { container } = render(
            <Col padding={{ expanded: 32 }}><text>A</text></Col>,
        );
        // Not zero — genuinely unset, exactly as if `padding` were omitted.
        expect(container.children[0]._style.paddingTop).toBeUndefined();
    });

    it('still accepts plain values', async () => {
        const { render, Row } = await atWidth(TABLET);
        const { container } = render(<Row gap={12} padding={16}><text>A</text></Row>);
        expect(container.children[0]._style.gap).toBe(12);
        expect(container.children[0]._style.paddingLeft).toBe(16);
    });
});
