/** Native Linking shim — the parts that don't need a bridge. */
import { isSigxError } from '@sigx/lynx-core';
import { describe, it, expect } from 'vitest';

import { Linking } from '../src/linking';

describe('Linking.addEventListener', () => {
    it('rejects an unknown event type with a coded SigxError (C10)', () => {
        const subscribe = Linking.addEventListener as unknown as (t: string, l: () => void) => void;
        let caught: unknown;
        try {
            subscribe('deeplink', () => {});
        } catch (e) {
            caught = e;
        }
        expect(isSigxError(caught)).toBe(true);
        expect(isSigxError(caught) && caught.code).toBe('unsupported_event');
        expect(isSigxError(caught) && caught.package).toBe('lynx-linking');
        expect((caught as Error).message).toBe(
            '[@sigx/lynx-linking] addEventListener failed: unknown event type "deeplink"',
        );
    });

    it('returns a no-op subscription when no GlobalEventEmitter exists', () => {
        const sub = Linking.addEventListener('url', () => {});
        expect(() => sub.remove()).not.toThrow();
    });
});
