/**
 * Token date formatting for the Lynx runtime, which ships no `Intl` (and so
 * no `toLocaleDateString`). Deliberately tiny and locale-free: numeric
 * components in **local time** plus an AM/PM marker — no month or weekday
 * names, which can't be produced correctly without locale data.
 */

/** Longest-first so `YYYY` wins over `YY`, `MM` over `M`, and so on. */
const TOKEN = /\[([^\]]*)\]|YYYY|YY|MM|DD|HH|hh|mm|ss|M|D|H|h|m|s|A|a/g;

const pad = (n: number): string => String(n).padStart(2, '0');

/** 24-hour clock → 12-hour dial (0 → 12, 13 → 1). */
const hour12 = (h: number): number => h % 12 || 12;

/**
 * Format a `Date` with `YYYY-MM-DD HH:mm`-style tokens.
 *
 * | Token | Meaning | Example |
 * |---|---|---|
 * | `YYYY` / `YY` | Year, 4- / 2-digit | `2026` / `26` |
 * | `MM` / `M` | Month, 1–12, padded / bare | `06` / `6` |
 * | `DD` / `D` | Day of month, padded / bare | `07` / `7` |
 * | `HH` / `H` | Hour 0–23, padded / bare | `09` / `9` |
 * | `hh` / `h` | Hour 1–12, padded / bare | `09` / `9` |
 * | `mm` / `m` | Minute, padded / bare | `05` / `5` |
 * | `ss` / `s` | Second, padded / bare | `05` / `5` |
 * | `A` / `a` | Meridiem | `PM` / `pm` |
 *
 * Anything else passes through literally. Wrap text in square brackets to
 * protect it from token substitution: `'[on] YYYY'` → `on 2026`.
 *
 * Returns `''` for a missing or Invalid Date, so a picker result can be
 * rendered without a null check:
 *
 * @example
 * ```ts
 * import { DateTimePicker, formatDate } from '@sigx/lynx-datetime-picker';
 *
 * const r = await DateTimePicker.pickDateTime();
 * label = formatDate(r.value, 'YYYY-MM-DD HH:mm'); // '' when cancelled
 * ```
 */
export function formatDate(date: Date | undefined | null, pattern: string): string {
    if (!date || Number.isNaN(date.getTime())) return '';
    const hours = date.getHours();
    return pattern.replace(TOKEN, (token, escaped: string | undefined) => {
        // `escaped` is the [bracketed] group — undefined unless it matched,
        // and '' for an empty `[]`, so test for undefined rather than falsy.
        if (escaped !== undefined) return escaped;
        switch (token) {
            case 'YYYY':
                return String(date.getFullYear());
            case 'YY':
                return pad(date.getFullYear() % 100);
            case 'MM':
                return pad(date.getMonth() + 1);
            case 'M':
                return String(date.getMonth() + 1);
            case 'DD':
                return pad(date.getDate());
            case 'D':
                return String(date.getDate());
            case 'HH':
                return pad(hours);
            case 'H':
                return String(hours);
            case 'hh':
                return pad(hour12(hours));
            case 'h':
                return String(hour12(hours));
            case 'mm':
                return pad(date.getMinutes());
            case 'm':
                return String(date.getMinutes());
            case 'ss':
                return pad(date.getSeconds());
            case 's':
                return String(date.getSeconds());
            case 'A':
                return hours < 12 ? 'AM' : 'PM';
            default:
                return hours < 12 ? 'am' : 'pm';
        }
    });
}
