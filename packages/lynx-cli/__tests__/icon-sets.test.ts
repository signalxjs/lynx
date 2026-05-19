import { describe, it, expect } from 'vitest';
import { resolveConfig } from '../src/config/parser.js';
import type { LynxConfig } from '../src/config/schema.js';

const BASE: LynxConfig = { name: 'IconTestApp', modules: [] };

describe('resolveConfig — iconSets', () => {
    it('defaults to an empty array when iconSets is omitted', () => {
        const resolved = resolveConfig({ ...BASE });
        expect(resolved.iconSets).toEqual([]);
    });

    it('normalises a minimal entry', () => {
        const resolved = resolveConfig({
            ...BASE,
            iconSets: [{ id: 'fa', source: '@sigx/lynx-icons-fa-free' }],
        });
        expect(resolved.iconSets).toEqual([
            {
                id: 'fa',
                source: '@sigx/lynx-icons-fa-free',
                styles: null,
                mode: null,
                include: [],
            },
        ]);
    });

    it('preserves styles, mode, and include', () => {
        const resolved = resolveConfig({
            ...BASE,
            iconSets: [
                {
                    id: 'fa',
                    source: '@sigx/lynx-icons-fa-free',
                    styles: ['solid', 'brands'],
                    mode: 'svg',
                    include: ['user', 'home'],
                },
            ],
        });
        expect(resolved.iconSets[0]).toMatchObject({
            styles: ['solid', 'brands'],
            mode: 'svg',
            include: ['user', 'home'],
        });
    });

    it('rejects duplicate ids', () => {
        expect(() =>
            resolveConfig({
                ...BASE,
                iconSets: [
                    { id: 'fa', source: '@sigx/lynx-icons-fa-free' },
                    { id: 'fa', source: '@sigx/lynx-icons-fa-pro' },
                ],
            }),
        ).toThrow(/Duplicate iconSets id "fa"/);
    });

    it('rejects empty id', () => {
        expect(() =>
            resolveConfig({
                ...BASE,
                iconSets: [{ id: '', source: '@sigx/lynx-icons-fa-free' }],
            }),
        ).toThrow(/id must be a non-empty string/);
    });

    it('rejects missing source', () => {
        expect(() =>
            resolveConfig({
                ...BASE,
                // @ts-expect-error — testing runtime validation
                iconSets: [{ id: 'fa' }],
            }),
        ).toThrow(/source must be a non-empty string/);
    });

    it('rejects unknown mode', () => {
        expect(() =>
            resolveConfig({
                ...BASE,
                iconSets: [
                    {
                        id: 'fa',
                        source: '@sigx/lynx-icons-fa-free',
                        // @ts-expect-error — testing runtime validation
                        mode: 'webfont',
                    },
                ],
            }),
        ).toThrow(/mode "webfont" is invalid/);
    });

    it('rejects unknown style', () => {
        expect(() =>
            resolveConfig({
                ...BASE,
                iconSets: [
                    {
                        id: 'fa',
                        source: '@sigx/lynx-icons-fa-free',
                        // @ts-expect-error — testing runtime validation
                        styles: ['bold'],
                    },
                ],
            }),
        ).toThrow(/unknown style "bold"/);
    });
});
