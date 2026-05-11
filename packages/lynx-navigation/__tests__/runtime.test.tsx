/**
 * Runtime tests for `<NavigationRoot>` + `<Stack>` + the typed hooks.
 *
 * Verifies:
 *  - Stack renders the top-of-stack entry's component
 *  - `nav.push` causes Stack to switch to the new entry's component (reactive)
 *  - `nav.pop` reverts to the previous entry
 *  - `nav.replace` swaps the top entry without growing the stack
 *  - `nav.popTo` / `popToRoot` collapse the stack as expected
 *  - `useParams` / `useSearch` return live values from the current entry
 *  - `nav.canGoBack` flips reactively as the stack grows/shrinks
 */
import { describe, expect, it } from 'vitest';
import { component } from '@sigx/lynx';
import { render, act } from '@sigx/lynx-testing';
import { useNav } from '../src/hooks/use-nav.js';
import { NavigationRoot } from '../src/components/NavigationRoot.js';
import { Stack } from '../src/components/Stack.js';
import { routes } from './_fixtures.js';

// ---------------------------------------------------------------------------
// Helper: a probe component that captures `nav` so tests can drive navigation
// imperatively without round-tripping through child JSX.
// ---------------------------------------------------------------------------

interface NavProbe {
    nav: ReturnType<typeof useNav> | null;
}

function makeProbe(): NavProbe {
    return { nav: null };
}

const NavCapture = component<{ probe: NavProbe } & {}>(({ props }) => {
    const nav = useNav();
    props.probe.nav = nav;
    return () => null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('<NavigationRoot> + <Stack>', () => {
    it('renders the initial route component', () => {
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <Stack />
            </NavigationRoot>,
        );
        expect(result.queryByText('Home')).not.toBeNull();
        result.unmount();
    });

    it('defaults initialRoute to the first key in routes when omitted', () => {
        const result = render(
            <NavigationRoot routes={routes} animated={false}>
                <Stack />
            </NavigationRoot>,
        );
        expect(result.queryByText('Home')).not.toBeNull();
        result.unmount();
    });

    it('throws when initialRoute is not in the routes registry', () => {
        expect(() =>
            render(
                <NavigationRoot routes={routes} initialRoute={'nope' as never} animated={false}>
                    <Stack />
                </NavigationRoot>,
            ),
        ).toThrow(/initialRoute='nope' is not in the routes registry/);
    });
});

describe('Imperative navigation', () => {
    it('push() switches the rendered component reactively', async () => {
        const probe = makeProbe();
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );
        expect(result.queryByText('Home')).not.toBeNull();
        expect(result.queryByText('profile-id:')).toBeNull();

        await act(() => {
            probe.nav!.push('profile', { id: '42' });
        });

        expect(result.queryByText('Home')).toBeNull();
        expect(result.queryByText('profile-id:')).not.toBeNull();
        result.unmount();
    });

    it('pop() reverts to the previous entry', async () => {
        const probe = makeProbe();
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );
        await act(() => probe.nav!.push('profile', { id: '42' }));
        expect(result.queryByText('profile-id:')).not.toBeNull();

        await act(() => probe.nav!.pop());
        expect(result.queryByText('Home')).not.toBeNull();
        expect(result.queryByText('profile-id:')).toBeNull();
        result.unmount();
    });

    it('replace() swaps the top entry without growing the stack', async () => {
        const probe = makeProbe();
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );
        await act(() => probe.nav!.replace('settings'));
        expect(probe.nav!.stack.length).toBe(1);
        expect(probe.nav!.current.route).toBe('settings');
        expect(result.queryByText('Settings')).not.toBeNull();
        result.unmount();
    });

    it('popTo() pops back to the named route', async () => {
        const probe = makeProbe();
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );
        await act(() => probe.nav!.push('settings'));
        await act(() => probe.nav!.push('profile', { id: '42' }));
        expect(probe.nav!.stack.length).toBe(3);

        await act(() => probe.nav!.popTo('home'));
        expect(probe.nav!.stack.length).toBe(1);
        expect(probe.nav!.current.route).toBe('home');
        expect(result.queryByText('Home')).not.toBeNull();
        result.unmount();
    });

    it('popToRoot() collapses to the root entry', async () => {
        const probe = makeProbe();
        render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );
        await act(() => probe.nav!.push('profile', { id: '42' }));
        await act(() => probe.nav!.push('settings'));
        expect(probe.nav!.stack.length).toBe(3);

        await act(() => probe.nav!.popToRoot());
        expect(probe.nav!.stack.length).toBe(1);
        expect(probe.nav!.current.route).toBe('home');
    });

    it('canGoBack flips reactively', async () => {
        const probe = makeProbe();
        render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );
        expect(probe.nav!.canGoBack).toBe(false);
        await act(() => probe.nav!.push('profile', { id: '42' }));
        expect(probe.nav!.canGoBack).toBe(true);
        await act(() => probe.nav!.pop());
        expect(probe.nav!.canGoBack).toBe(false);
    });

    it('push() to an unknown route throws', async () => {
        const probe = makeProbe();
        render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );
        expect(() => (probe.nav as unknown as { push: (n: string) => void }).push('porfile')).toThrow(
            /route is not registered/,
        );
    });
});

describe('useParams / useSearch reactivity', () => {
    it('useParams returns the current entry params', async () => {
        const probe = makeProbe();
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );
        await act(() =>
            probe.nav!.push('profile', { id: 'abc-123' }, { tab: 'posts' }),
        );
        expect(result.queryByText('profile-id:abc-123')).not.toBeNull();
        result.unmount();
    });

    it('useSearch returns the current entry search', async () => {
        const probe = makeProbe();
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );
        await act(() =>
            probe.nav!.push('profile', { id: 'a' }, { tab: 'about' }),
        );
        expect(result.queryByText('profile-tab:about')).not.toBeNull();
        result.unmount();
    });
});
