/**
 * Pilot components, wave 1 (#1045): every component held to BOTH oracles
 * (anatomy + class grammar) in every state the test drives it through, plus
 * its interaction flows via lynx-testing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { component, signal } from '@sigx/lynx';
import { Accordion, Button, Progress, Switch, Tabs, registerAxisDefaults } from '../src/index';
import { clearAxisDefaults } from '../src/contract/axis-defaults';
import { expectAnatomy, expectClassGrammar } from '../src/testing/index';

const conforms = (container: never, scope: keyof typeof anatomies): void => {
    expectAnatomy(container, anatomies[scope]);
    expectClassGrammar(container, anatomies[scope]);
};

describe('Progress', () => {
    it('maps value to state and range width; conforms in each', () => {
        const { container } = render(
            <Progress.Root value={null} max={100} color="primary" size="md">
                <Progress.Label>Loading</Progress.Label>
                <Progress.Track>
                    <Progress.Range />
                </Progress.Track>
                <Progress.ValueText>…</Progress.ValueText>
            </Progress.Root>,
        );
        expect(container.findByText('Loading')).not.toBeNull();
        conforms(container as never, 'progress');
        // indeterminate at null
        expect(String(container.children[0]!.props['data-state'])).toBe('indeterminate');
    });

    it('loading, complete, and the range width; NaN inputs stay finite', () => {
        const loading = render(
            <Progress.Root value={40}><Progress.Track><Progress.Range /></Progress.Track></Progress.Root>,
        ).container;
        expect(String(loading.children[0]!.props['data-state'])).toBe('loading');
        expect(loading.children[0]!.children[0]!.children[0]!._style['width']).toBe('40%');
        conforms(loading as never, 'progress');

        const complete = render(<Progress.Root value={100} />).container;
        expect(String(complete.children[0]!.props['data-state'])).toBe('complete');
        conforms(complete as never, 'progress');

        // 0/0 and a non-finite max must never emit NaN% (Copilot's catch).
        const zeroMax = render(
            <Progress.Root value={0} max={0}><Progress.Track><Progress.Range /></Progress.Track></Progress.Root>,
        ).container;
        expect(zeroMax.children[0]!.children[0]!.children[0]!._style['width']).toBe('0%');
        const nanValue = render(<Progress.Root value={Number.NaN} />).container;
        expect(String(nanValue.children[0]!.props['data-state'])).toBe('indeterminate');
    });
});

describe('Button', () => {
    it('press feedback + disabled semantics + conformance', async () => {
        let presses = 0;
        const disabled = signal({ current: false });
        const Probe = component(() => () => (
            <Button.Root color="primary" disabled={disabled.current} onPress={() => presses++} label="Save">
                <text>Save</text>
            </Button.Root>
        ));
        const { container } = render(<Probe />);
        conforms(container as never, 'button');
        const root = container.children[0]!;
        await act(() => fireEvent.tap(root as never));
        expect(presses).toBe(1);
        await act(() => fireEvent.touchStart(root as never));
        expect(String(root.props['data-pressed'])).toBe('');
        expect(root._class).toContain('zx-f-pressed');
        conforms(container as never, 'button');
        await act(() => fireEvent.touchEnd(root as never));
        expect(root.props['data-pressed']).toBeUndefined();

        await act(() => { disabled.current = true; });
        await act(() => fireEvent.tap(root as never));
        expect(presses).toBe(1);
        expect(root.props['accessibility-status']).toBe('disabled');
        conforms(container as never, 'button');
    });
});

describe('Switch', () => {
    it('toggles through tap, renders control/thumb states, conforms', async () => {
        const changes: boolean[] = [];
        const { container } = render(
            <Switch.Root color="primary" label="Notifications" onCheckedChange={(v: boolean) => changes.push(v)}>
                Notifications
            </Switch.Root>,
        );
        const root = container.children[0]!;
        expect(String(root.props['data-state'])).toBe('unchecked');
        conforms(container as never, 'switch');
        await act(() => fireEvent.tap(root as never));
        expect(String(root.props['data-state'])).toBe('checked');
        expect(changes).toEqual([true]);
        expect(root.props['accessibility-status']).toBe('checked');
        conforms(container as never, 'switch');
    });
});

describe('Tabs', () => {
    const Probe = () => (
        <Tabs.Root defaultValue="a" size="sm" orientation="horizontal">
            <Tabs.List>
                <Tabs.Tab value="a"><text>A</text></Tabs.Tab>
                <Tabs.Tab value="b"><text>B</text></Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="a"><text>panel-a</text></Tabs.Panel>
            <Tabs.Panel value="b"><text>panel-b</text></Tabs.Panel>
        </Tabs.Root>
    );

    it('activates on tap; only the active panel renders; axes push down', async () => {
        const { container } = render(<Probe />);
        conforms(container as never, 'tabs');
        expect(container.textContent()).toContain('panel-a');
        expect(container.textContent()).not.toContain('panel-b');
        // The size axis stamped on a non-carrier part — the push-down rule.
        const tabB = container.findByText('B')!.parent!.parent!;
        expect(tabB._class).toContain('zx-a-size-sm');
        expect(String(tabB.props['data-state'])).toBe('inactive');
        await act(() => fireEvent.tap(tabB as never));
        expect(String(tabB.props['data-state'])).toBe('active');
        expect(container.textContent()).toContain('panel-b');
        expect(container.textContent()).not.toContain('panel-a');
        conforms(container as never, 'tabs');
    });
});

describe('Accordion', () => {
    const Probe = () => (
        <Accordion.Root defaultValue={['one']} multiple>
            <Accordion.Item value="one">
                <Accordion.Trigger><text>One</text></Accordion.Trigger>
                <Accordion.Panel><text>content-one</text></Accordion.Panel>
            </Accordion.Item>
            <Accordion.Item value="two">
                <Accordion.Trigger><text>Two</text></Accordion.Trigger>
                <Accordion.Panel><text>content-two</text></Accordion.Panel>
            </Accordion.Item>
        </Accordion.Root>
    );

    it('toggles items; multiple keeps both open; conforms throughout', async () => {
        const { container } = render(<Probe />);
        conforms(container as never, 'accordion');
        expect(container.textContent()).toContain('content-one');
        expect(container.textContent()).not.toContain('content-two');
        const triggerTwo = container.findByText('Two')!.parent!.parent!;
        await act(() => fireEvent.tap(triggerTwo as never));
        expect(container.textContent()).toContain('content-one');
        expect(container.textContent()).toContain('content-two');
        conforms(container as never, 'accordion');
        await act(() => fireEvent.tap(triggerTwo as never));
        expect(container.textContent()).not.toContain('content-two');
        conforms(container as never, 'accordion');
    });
});

describe('axis defaults (#1070)', () => {
    beforeEach(() => {
        registerAxisDefaults({
            button: { color: 'primary', variant: 'solid', size: 'md' },
            switch: { color: 'primary' },
        });
    });
    afterEach(clearAxisDefaults);

    it('a prop-less Button stamps the design system defaults', () => {
        const { container } = render(<Button.Root><text>Save</text></Button.Root>);
        const root = container.children[0]!;
        expect(root._class).toContain('zx-a-color-primary');
        expect(root._class).toContain('zx-a-variant-solid');
        expect(root._class).toContain('zx-a-size-md');
        conforms(container as never, 'button');
    });

    it('an explicit prop wins; the other axes still default', () => {
        const { container } = render(<Button.Root color="secondary"><text>Save</text></Button.Root>);
        const root = container.children[0]!;
        expect(root._class).toContain('zx-a-color-secondary');
        expect(root._class).not.toContain('zx-a-color-primary');
        expect(root._class).toContain('zx-a-variant-solid');
        expect(root._class).toContain('zx-a-size-md');
    });

    it('Switch defaults its color', () => {
        const { container } = render(<Switch.Root label="Notifications">Notifications</Switch.Root>);
        expect(container.children[0]!._class).toContain('zx-a-color-primary');
    });

    it('with nothing registered a prop-less Button stamps no axis class', () => {
        clearAxisDefaults();
        const { container } = render(<Button.Root><text>Save</text></Button.Root>);
        expect(container.children[0]!._class).not.toContain('zx-a-');
    });
});
