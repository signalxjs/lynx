/**
 * Unit tests for the token formatter. All assertions construct dates with
 * the local-time `Date` constructor and read back local components, so they
 * hold in any timezone the suite runs in.
 */
import { describe, expect, it } from 'vitest';

import { formatDate } from '../src/format-date.js';

describe('formatDate', () => {
    it('formats the documented example pattern', () => {
        expect(formatDate(new Date(2026, 5, 7, 14, 30), 'YYYY-MM-DD HH:mm')).toBe(
            '2026-06-07 14:30',
        );
    });

    it('zero-pads the padded tokens', () => {
        const d = new Date(2026, 0, 2, 3, 4, 5);
        expect(formatDate(d, 'YYYY|YY|MM|DD|HH|hh|mm|ss')).toBe(
            '2026|26|01|02|03|03|04|05',
        );
    });

    it('leaves the bare tokens unpadded', () => {
        const d = new Date(2026, 0, 2, 3, 4, 5);
        expect(formatDate(d, 'M/D H:m:s')).toBe('1/2 3:4:5');
    });

    it('maps the 12-hour dial and meridiem across midnight and noon', () => {
        expect(formatDate(new Date(2026, 5, 7, 0, 5), 'hh:mm A')).toBe('12:05 AM');
        expect(formatDate(new Date(2026, 5, 7, 12, 5), 'hh:mm A')).toBe('12:05 PM');
        expect(formatDate(new Date(2026, 5, 7, 13, 5), 'h:mm a')).toBe('1:05 pm');
        expect(formatDate(new Date(2026, 5, 7, 11, 59), 'h:mm a')).toBe('11:59 am');
    });

    it('passes non-token text through and honours [escapes]', () => {
        const d = new Date(2026, 5, 7, 14, 30);
        expect(formatDate(d, '[Picked on] YYYY-MM-DD')).toBe('Picked on 2026-06-07');
        // A bare 'at' would otherwise be eaten: 'a' is the meridiem token.
        expect(formatDate(d, 'DD [at] HH:mm')).toBe('07 at 14:30');
        expect(formatDate(d, '[]YYYY')).toBe('2026');
    });

    it('returns an empty string for a missing or Invalid Date', () => {
        expect(formatDate(undefined, 'YYYY-MM-DD')).toBe('');
        expect(formatDate(null, 'YYYY-MM-DD')).toBe('');
        expect(formatDate(new Date(Number.NaN), 'YYYY-MM-DD')).toBe('');
    });

    it('two-digit-years pads years below 2010', () => {
        expect(formatDate(new Date(2005, 0, 1), 'YY')).toBe('05');
        expect(formatDate(new Date(2000, 0, 1), 'YY')).toBe('00');
    });

    it('is exported from the package barrel', async () => {
        const barrel = await import('../src/index.js');
        expect(barrel.formatDate).toBe(formatDate);
    });
});
