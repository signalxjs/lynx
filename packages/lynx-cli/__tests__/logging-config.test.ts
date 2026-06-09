/**
 * `resolveConfig` exports the app's `logging` config to `process.env` so the
 * rspeedy child (which inherits it) can let `@sigx/lynx-plugin` inject the
 * logger defaults and auto-wire observability. See parser.ts / plugin index.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config/parser.js';
import type { LynxConfig } from '../src/config/schema.js';

afterEach(() => {
    delete process.env['SIGX_LYNX_LOGGING'];
});

describe('resolveConfig — logging env plumbing', () => {
    it('exports the full logging config as SIGX_LYNX_LOGGING', () => {
        const logging: LynxConfig['logging'] = {
            level: 'warn',
            namespaces: { disabled: ['http'] },
            production: { sink: { url: 'https://logs.example.com', minLevel: 'info' }, captureErrors: true },
        };
        resolveConfig({ name: 'demo', logging });
        expect(JSON.parse(process.env['SIGX_LYNX_LOGGING']!)).toEqual(logging);
    });

    it('exports `{}` when no logging is configured', () => {
        resolveConfig({ name: 'demo' });
        expect(process.env['SIGX_LYNX_LOGGING']).toBe('{}');
    });
});
