import { describe, it, expect } from 'vitest';
import { scanContent } from '../src/icons';

describe('scanContent', () => {
    it('matches set-first then name', () => {
        expect(scanContent('<Icon set="fa" name="user" />')).toEqual([
            { set: 'fa', name: 'user' },
        ]);
    });

    it('matches name-first then set', () => {
        expect(scanContent('<Icon name="user" set="fa" />')).toEqual([
            { set: 'fa', name: 'user' },
        ]);
    });

    it('handles kebab-case names', () => {
        expect(scanContent('<Icon set="lucide" name="chevron-right" />')).toEqual([
            { set: 'lucide', name: 'chevron-right' },
        ]);
    });

    it('allows extra attributes between set and name', () => {
        const src = '<Icon set="fa" size={20} color="#333" name="user" />';
        expect(scanContent(src)).toEqual([{ set: 'fa', name: 'user' }]);
    });

    it('handles single quotes', () => {
        expect(scanContent("<Icon set='fa' name='user' />")).toEqual([
            { set: 'fa', name: 'user' },
        ]);
    });

    it('collects multiple icons from one file', () => {
        const src = `
            <Icon set="fa" name="user" />
            <Icon set="fa" name="house" />
            <Icon set="lucide" name="search" />
        `;
        expect(scanContent(src)).toEqual([
            { set: 'fa', name: 'user' },
            { set: 'fa', name: 'house' },
            { set: 'lucide', name: 'search' },
        ]);
    });

    it('deduplicates repeated usages', () => {
        const src = `
            <Icon set="fa" name="user" />
            <Icon name="user" set="fa" />
            <Icon set="fa" name="user" size={20} />
        `;
        expect(scanContent(src)).toEqual([{ set: 'fa', name: 'user' }]);
    });

    it('returns nothing when no <Icon found', () => {
        expect(scanContent('export const x = 1;')).toEqual([]);
        expect(scanContent('<button>hello</button>')).toEqual([]);
    });

    it('ignores dynamic name expressions', () => {
        // `name={…}` is intentionally not matched; user must use `include: []` in config.
        expect(scanContent('<Icon set="fa" name={dynamic} />')).toEqual([]);
    });

    it('does not match Icon-prefixed components', () => {
        // <IconButton> isn't <Icon>.
        expect(scanContent('<IconButton set="fa" name="x" />')).toEqual([]);
    });

    describe('pinned per-set components', () => {
        it('matches FaSolidIcon → set "fas"', () => {
            expect(scanContent('<FaSolidIcon name="user" />')).toEqual([
                { set: 'fas', name: 'user' },
            ]);
        });

        it('matches FaRegularIcon → set "far"', () => {
            expect(scanContent('<FaRegularIcon name="bell" />')).toEqual([
                { set: 'far', name: 'bell' },
            ]);
        });

        it('matches FaBrandIcon → set "fab"', () => {
            expect(scanContent('<FaBrandIcon name="github" />')).toEqual([
                { set: 'fab', name: 'github' },
            ]);
        });

        it('matches LucideIcon → set "lucide"', () => {
            expect(scanContent('<LucideIcon name="map" />')).toEqual([
                { set: 'lucide', name: 'map' },
            ]);
        });

        it('handles other attributes before name', () => {
            const src = '<FaSolidIcon size={24} variant="primary" name="user" />';
            expect(scanContent(src)).toEqual([{ set: 'fas', name: 'user' }]);
        });

        it('ignores dynamic name on pinned components', () => {
            expect(scanContent('<LucideIcon name={dynamic} />')).toEqual([]);
        });

        it('does not match unknown pinned components', () => {
            // Consumer-defined pinned components aren't in PINNED_COMPONENTS;
            // they need `include` in signalx.config.ts.
            expect(scanContent('<MyCustomIcon name="x" />')).toEqual([]);
        });
    });

    describe('IconSpec object literals', () => {
        it('matches set-first object literal', () => {
            expect(scanContent("const s = { set: 'lucide', name: 'map' };")).toEqual([
                { set: 'lucide', name: 'map' },
            ]);
        });

        it('matches name-first object literal', () => {
            expect(scanContent("const s = { name: 'map', set: 'lucide' };")).toEqual([
                { set: 'lucide', name: 'map' },
            ]);
        });

        it('matches inline in JSX attribute (double-braced)', () => {
            const src = `<Tabs.Screen name="trips" icon={{ set: 'lucide', name: 'map' }}>`;
            expect(scanContent(src)).toEqual([{ set: 'lucide', name: 'map' }]);
        });

        it('matches backIcon prop value', () => {
            const src = `<NavHeader backIcon={{ set: 'lucide', name: 'chevron-left' }} />`;
            expect(scanContent(src)).toEqual([
                { set: 'lucide', name: 'chevron-left' },
            ]);
        });

        it('handles double quotes', () => {
            expect(scanContent('{ set: "fas", name: "user" }')).toEqual([
                { set: 'fas', name: 'user' },
            ]);
        });

        it('ignores dynamic values', () => {
            expect(scanContent("{ set: getSet(), name: 'map' }")).toEqual([]);
            expect(scanContent("{ set: 'lucide', name: dynamicName }")).toEqual([]);
        });

        it('deduplicates across JSX + spec forms', () => {
            const src = `
                <Icon set="lucide" name="map" />
                <LucideIcon name="map" />
                const s = { set: 'lucide', name: 'map' };
            `;
            expect(scanContent(src)).toEqual([{ set: 'lucide', name: 'map' }]);
        });
    });

    describe('combined patterns across one file', () => {
        it('collects every matched form once', () => {
            const src = `
                import { LucideIcon } from '@sigx/lynx-icons-lucide/components';
                const backChevron = { set: 'lucide', name: 'chevron-left' };
                <Tabs.Screen icon={{ set: 'lucide', name: 'map' }}>
                    <NavHeader backIcon={backChevron} />
                </Tabs.Screen>
                <LucideIcon name="menu" />
                <Icon set="fas" name="plus" />
            `;
            expect(scanContent(src)).toEqual([
                { set: 'fas', name: 'plus' },
                { set: 'lucide', name: 'menu' },
                { set: 'lucide', name: 'chevron-left' },
                { set: 'lucide', name: 'map' },
            ]);
        });
    });
});
