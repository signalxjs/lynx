/** Screen activity (#1308): the contract navigators provide per screen. */
import { describe, expect, it } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { component, provideScreenActive, signal, useScreenActive } from '../src/index';
import type { Define, ScreenActive } from '../src/index';

describe('useScreenActive', () => {
    it('is always active outside any provider', () => {
        let read: ScreenActive | null = null;
        const Probe = component(() => {
            read = useScreenActive();
            return () => null;
        });
        render(<Probe />);
        expect(read!()).toBe(true);
    });

    it('a nested provider is active only while the enclosing one is', () => {
        const outer = signal({ active: true });
        const inner = signal({ active: true });
        let read: ScreenActive | null = null;
        type P = Define.Prop<'state', { active: boolean }, true> & Define.Slot<'default'>;
        const Scope = component<P>(({ props, slots }) => {
            provideScreenActive(() => props.state.active);
            return () => <view>{slots.default?.()}</view>;
        });
        const Probe = component(() => {
            read = useScreenActive();
            return () => null;
        });
        render(<Scope state={outer}><Scope state={inner}><Probe /></Scope></Scope>);
        expect(read!()).toBe(true);
        inner.active = false;
        expect(read!()).toBe(false);
        inner.active = true;
        outer.active = false;
        expect(read!()).toBe(false);
    });
});
