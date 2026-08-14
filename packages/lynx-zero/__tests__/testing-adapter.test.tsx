/**
 * The conformance surface itself (#1043): a partBag-rendered tree passes
 * both oracles, and mutations fail red — a gate is only trusted after it
 * has been watched failing.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { component } from '@sigx/lynx';
import { partBag } from '../src/index';
import { expectAnatomy, expectClassGrammar } from '../src/testing/index';

const tabs = anatomies.tabs;

const Probe = component<{ broken?: boolean }>(({ props }) => () => (
    <view {...partBag(tabs, 'root', { orientation: 'horizontal', axes: { size: 'md' } })}>
        <view {...partBag(tabs, 'list', { orientation: 'horizontal' })}>
            <view
                {...partBag(tabs, 'tab', { state: 'active', flags: { disabled: true }, axes: { size: 'md' }, class: 'app-extra' })}
                {...(props.broken ? { 'data-bogus': '' } : {})}
            >
                <text>Tab A</text>
            </view>
        </view>
        <view {...partBag(tabs, 'panel', { state: 'active' })}>
            <text>Panel</text>
        </view>
    </view>
));

describe('expectAnatomy over TestNode', () => {
    it('a partBag tree passes the seven rules', () => {
        const { container } = render(<Probe />);
        expect(() => expectAnatomy(container, tabs)).not.toThrow();
    });

    it('an undeclared flag fails red', () => {
        const { container } = render(<Probe broken />);
        expect(() => expectAnatomy(container, tabs)).toThrow(/undeclared flag "bogus"/);
    });
});

describe('expectClassGrammar over TestNode', () => {
    it('classes derived from the same inputs agree', () => {
        const { container } = render(<Probe />);
        expect(() => expectClassGrammar(container, tabs)).not.toThrow();
    });

    it('a class/data disagreement fails red, naming the drift', () => {
        const Drifted = component(() => () => (
            // data says active, class says nothing — the exact drift the
            // oracle exists to catch (a hand-written class list).
            <view data-scope="tabs" data-part="tab" data-state="active" class="zx-tabs__tab">
                <text>drifted</text>
            </view>
        ));
        const { container } = render(<Drifted />);
        expect(() => expectClassGrammar(container, tabs)).toThrow(/missing: zx-s-active/);
    });
});
