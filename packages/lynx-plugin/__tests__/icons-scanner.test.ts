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
});
