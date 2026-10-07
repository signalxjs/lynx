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
 * lowercase letter following a digit stays in the same segment.
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
            out.push(kebabFromPascal(rest));
        }
        return out;
    },
};

export default adapter;
