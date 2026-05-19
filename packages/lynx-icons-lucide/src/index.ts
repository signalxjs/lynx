import { createRequire } from 'node:module';
import type { GlyphData, IconAdapter } from '@sigx/lynx-icons';

const require = createRequire(import.meta.url);

type LucideAttrs = Record<string, string | number>;
type LucideElement = [string, LucideAttrs];
type LucideIcon = LucideElement[];

let lucideModule: Record<string, LucideIcon> | null | undefined;

function loadLucide(): Record<string, LucideIcon> | null {
    if (lucideModule !== undefined) return lucideModule;
    try {
        lucideModule = require('lucide') as Record<string, LucideIcon>;
    } catch {
        lucideModule = null;
    }
    return lucideModule;
}

/** Convert kebab-case → PascalCase (lucide's export naming). `a-arrow-down` → `AArrowDown`. */
function exportNameFor(name: string): string {
    return name.split('-').map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1)).join('');
}

/**
 * Inverse of `exportNameFor`: insert `-` before every uppercase letter that
 * isn't the first character, then lowercase. Mirrors the way `exportNameFor`
 * builds names from kebab segments.
 *
 * - `User` → `user`
 * - `ChevronRight` → `chevron-right`
 * - `AArrowDown` → `a-arrow-down` (lucide really has names like this)
 */
function kebabFromPascal(exportName: string): string {
    if (exportName.length === 0) return '';
    let out = exportName.charAt(0).toLowerCase();
    for (let i = 1; i < exportName.length; i++) {
        const ch = exportName.charAt(i);
        if (ch >= 'A' && ch <= 'Z') {
            out += '-' + ch.toLowerCase();
        } else {
            out += ch;
        }
    }
    return out;
}

function escapeAttr(value: string | number): string {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function renderElement(el: LucideElement): string {
    const [tag, attrs] = el;
    const parts: string[] = [];
    for (const [k, v] of Object.entries(attrs)) {
        parts.push(`${k}="${escapeAttr(v)}"`);
    }
    return `<${tag} ${parts.join(' ')}/>`;
}

const adapter: IconAdapter = {
    /** Lucide is a single-style set; we still expose one entry so iteration works. */
    styles: [''],

    getGlyph(_style: string, name: string): GlyphData | null {
        const lucide = loadLucide();
        if (!lucide) return null;
        const icon = lucide[exportNameFor(name)];
        if (!Array.isArray(icon)) return null;
        const inner = icon.map(renderElement).join('');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="__COLOR__" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
        return { svg };
    },

    /** Lucide has no font distribution. Always null → forces SVG mode. */
    getFontPath(): string | null {
        return null;
    },

    listGlyphs(_style: string): string[] {
        const lucide = loadLucide();
        if (!lucide) return [];
        const out: string[] = [];
        for (const [key, value] of Object.entries(lucide)) {
            if (!Array.isArray(value)) continue;
            // Lucide also exports a `createLucideIcon` helper etc. — skip
            // anything that doesn't start with an uppercase letter (icon
            // names are PascalCase).
            const first = key.charAt(0);
            if (first < 'A' || first > 'Z') continue;
            out.push(kebabFromPascal(key));
        }
        return out;
    },
};

export default adapter;
