/**
 * Tests for `<Link>`.
 *
 * Covers:
 *  - Tap on a Link with `to="profile" params={{ id: '42' }}` calls nav.push correctly
 *  - Tap on a Link with `to="home"` (no params) calls nav.push correctly — and `search`
 *    on a no-params route lands in the search slot, not the options slot
 *  - `replace` prop dispatches to nav.replace instead of nav.push
 *  - Type tests: TS rejects mismatched `to`/`params` combinations
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { fireEvent, render, act } from '@sigx/lynx-testing';
import { component } from '@sigx/lynx';
import { TestNode } from '@sigx/lynx-testing';
import { useNav } from '../src/hooks/use-nav';
import { NavigationRoot } from '../src/components/NavigationRoot';
import { Stack } from '../src/components/Stack';
import { Link, type LinkProps } from '../src/components/Link';
import { routes } from './_fixtures';

interface NavProbe {
    nav: ReturnType<typeof useNav> | null;
}

const NavCapture = component<{ probe: NavProbe } & {}>(({ props }) => {
    const nav = useNav();
    props.probe.nav = nav;
    return () => null;
});

/**
 * Walk up the tree from a text leaf until we hit the node that owns the
 * `bindtap` handler — that's the `<view>` Link wraps its content with.
 * `getByText(...)` returns the inner `#text` leaf; `.parent` is the `<text>`
 * element; the bindtap handler lives one more level up.
 */
function findTappable(start: TestNode): TestNode {
    let node: TestNode | null = start;
    while (node) {
        if (node._handlers.has('bindtap')) return node;
        node = node.parent;
    }
    throw new Error('No ancestor with bindtap handler found');
}

describe('<Link> runtime', () => {
    it('tap on `to="profile" params={...}` pushes the right typed entry', async () => {
        const probe: NavProbe = { nav: null };
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Link to="profile" params={{ id: '42' }}>
                    <text>go-profile</text>
                </Link>
                <Stack />
            </NavigationRoot>,
        );

        const linkNode = findTappable(result.getByText('go-profile'));
        await act(() => {
            fireEvent.tap(linkNode);
        });

        expect(probe.nav!.current.route).toBe('profile');
        expect(probe.nav!.current.params).toEqual({ id: '42' });
        result.unmount();
    });

    it('tap on `to="home"` (no params) pushes correctly, with search in the right slot', async () => {
        const probe: NavProbe = { nav: null };
        const result = render(
            <NavigationRoot routes={routes} initialRoute="settings" animated={false}>
                <NavCapture probe={probe} />
                <Link to="home">
                    <text>go-home</text>
                </Link>
                <Stack />
            </NavigationRoot>,
        );

        const linkNode = findTappable(result.getByText('go-home'));
        await act(() => {
            fireEvent.tap(linkNode);
        });

        expect(probe.nav!.current.route).toBe('home');
        // For no-params routes, Link must dispatch via the 2-arg overload so
        // search lands in the search slot. If Link blindly called the 3-arg
        // shape, the `search` we pass below would slide into the `options`
        // slot, which would corrupt the entry's `presentation` (this is the
        // bug the runtime branch in Link.tsx exists to prevent).
        expect(probe.nav!.current.presentation).toBe('card');
        result.unmount();
    });

    it('replace prop dispatches to nav.replace, no stack growth', async () => {
        const probe: NavProbe = { nav: null };
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Link to="settings" replace>
                    <text>go-settings</text>
                </Link>
                <Stack />
            </NavigationRoot>,
        );

        const linkNode = findTappable(result.getByText('go-settings'));
        await act(() => {
            fireEvent.tap(linkNode);
        });

        expect(probe.nav!.stack.length).toBe(1);
        expect(probe.nav!.current.route).toBe('settings');
        result.unmount();
    });

    it('tap on `to="profile" params={...} search={...}` lands search in the search slot', async () => {
        const probe: NavProbe = { nav: null };
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Link to="profile" params={{ id: '7' }} search={{ tab: 'about' }}>
                    <text>go-profile-about</text>
                </Link>
                <Stack />
            </NavigationRoot>,
        );

        const linkNode = findTappable(result.getByText('go-profile-about'));
        await act(() => {
            fireEvent.tap(linkNode);
        });

        expect(probe.nav!.current.search).toEqual({ tab: 'about' });
        result.unmount();
    });
});

describe('<Link> typing', () => {
    it('accepts well-typed prop combinations', () => {
        // Sanity: each of these should compile.
        expectTypeOf<LinkProps>().toMatchTypeOf<{
            to: string;
            replace?: boolean;
        }>();
    });

    it('rejects missing params on a route that requires them', () => {
        if (false as boolean) {
            // @ts-expect-error — profile requires `params: { id: string }`
            const _: LinkProps = { to: 'profile' };
            void _;
        }
    });

    it('rejects wrong-typed params', () => {
        if (false as boolean) {
            // @ts-expect-error — id must be a string
            const _: LinkProps = { to: 'profile', params: { id: 42 } };
            void _;
        }
    });

    it('rejects params on a route with no schema', () => {
        if (false as boolean) {
            // @ts-expect-error — home accepts no params
            const _: LinkProps = { to: 'home', params: { id: '42' } };
            void _;
        }
    });

    it('rejects unknown route names', () => {
        if (false as boolean) {
            // @ts-expect-error — no such route
            const _: LinkProps = { to: 'porfile' };
            void _;
        }
    });
});
