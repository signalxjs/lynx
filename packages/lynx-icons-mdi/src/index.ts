import { createRequire } from 'node:module';
import type { GlyphData, IconAdapter } from '@sigx/lynx-icons';

const require = createRequire(import.meta.url);

let mdiModule: Record<string, unknown> | null | undefined;

function loadMdi(): Record<string, unknown> | null {
    if (mdiModule !== undefined) return mdiModule;
    try {
        mdiModule = require('@mdi/js') as Record<string, unknown>;
    } catch {
        mdiModule = null;
    }
    return mdiModule;
}

/** Convert kebab-case → `@mdi/js` export name. `signal-cellular-outline` → `mdiSignalCellularOutline`. */
function exportNameFor(name: string): string {
    return 'mdi' + name.split('-').map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1)).join('');
}

/**
 * Inverse of `exportNameFor` (without the `mdi` prefix): insert `-` before
 * every uppercase letter and before the first digit of each digit run, then
 * lowercase. MDI starts numeric segments with the digit itself, so a
 * lowercase letter following a digit stays in the same segment. The few
 * names that break this rule are listed in `IRREGULAR_NAMES`.
 *
 * - `SignalCellularOutline` → `signal-cellular-outline`
 * - `Battery10` → `battery-10`
 * - `AlphaABox` → `alpha-a-box`
 * - `Signal3g` → `signal-3g`
 */
function kebabFromPascal(pascal: string): string {
    let out = '';
    for (let i = 0; i < pascal.length; i++) {
        const ch = pascal.charAt(i);
        const isUpper = ch >= 'A' && ch <= 'Z';
        const isDigit = ch >= '0' && ch <= '9';
        const prev = pascal.charAt(i - 1);
        const prevIsDigit = prev >= '0' && prev <= '9';
        if (i > 0 && (isUpper || (isDigit && !prevIsDigit))) out += '-';
        out += ch.toLowerCase();
    }
    return out;
}

/**
 * Canonical MDI names `kebabFromPascal` can't derive: the PascalCase export
 * drops the separator, and these keep a digit attached to its letters
 * (`language-html5`, not `language-html-5`) or split a digit run
 * (`surround-sound-5-1`, not `surround-sound-51`). `getGlyph` accepts either
 * spelling; this only fixes the names `listGlyphs` reports, which
 * `include: ['*']` registers glyphs under. The adapter test compares the
 * whole catalog against `@mdi/svg`'s `meta.json`, so a new irregular name
 * fails CI on an `@mdi/js` bump instead of shipping misnamed.
 */
const IRREGULAR_NAMES: readonly string[] = [
    'dice-d4', 'dice-d4-outline', 'dice-d6', 'dice-d6-outline', 'dice-d8', 'dice-d8-outline',
    'dice-d10', 'dice-d10-outline', 'dice-d12', 'dice-d12-outline', 'dice-d20', 'dice-d20-outline',
    'ev-plug-ccs1', 'ev-plug-ccs2', 'ev-plug-type1', 'ev-plug-type2',
    'keyboard-f1', 'keyboard-f2', 'keyboard-f3', 'keyboard-f4', 'keyboard-f5', 'keyboard-f6',
    'keyboard-f7', 'keyboard-f8', 'keyboard-f9', 'keyboard-f10', 'keyboard-f11', 'keyboard-f12',
    'language-css3', 'language-html5', 'molecule-co2',
    'surround-sound-2-0', 'surround-sound-2-1', 'surround-sound-3-1', 'surround-sound-5-1',
    'surround-sound-5-1-2', 'surround-sound-7-1',
];

/** `@mdi/js` export name → canonical name, for the names above. */
const IRREGULAR_BY_EXPORT = new Map(IRREGULAR_NAMES.map((name) => [exportNameFor(name), name]));

function escapeAttr(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

const adapter: IconAdapter = {
    /** MDI is a single-style set; we still expose one entry so iteration works. */
    styles: [''],

    getGlyph(_style: string, name: string): GlyphData | null {
        const mdi = loadMdi();
        if (!mdi) return null;
        const d = mdi[exportNameFor(name)];
        if (typeof d !== 'string') return null;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="${escapeAttr(d)}"/></svg>`;
        return { svg };
    },

    /** `@mdi/js` ships path data only, no font. Always null → forces SVG mode. */
    getFontPath(): string | null {
        return null;
    },

    listGlyphs(_style: string): string[] {
        const mdi = loadMdi();
        if (!mdi) return [];
        const out: string[] = [];
        for (const [key, value] of Object.entries(mdi)) {
            if (typeof value !== 'string') continue;
            // Every icon export is `mdi` + PascalCase; skip anything else.
            if (!key.startsWith('mdi')) continue;
            const rest = key.slice(3);
            const first = rest.charAt(0);
            if (first < 'A' || first > 'Z') continue;
            out.push(IRREGULAR_BY_EXPORT.get(key) ?? kebabFromPascal(rest));
        }
        return out;
    },
};

export default adapter;
