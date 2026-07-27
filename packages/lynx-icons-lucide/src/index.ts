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

/**
 * Rewrite the SVG primitives Lynx's `<svg content=…>` renderer drops.
 *
 * `<line>`, `<polyline>` and `<polygon>` silently don't paint on Lynx —
 * `hash` (four lines, nothing else) came out completely blank and `smile`
 * lost its eyes. 98 of lucide's 1,956 icons contain at least one. All three
 * are trivially expressible as `<path>`, which does paint, so they are
 * converted here rather than shipped broken.
 *
 * Returns `null` when the element isn't one of those (or lacks the
 * coordinates to convert), leaving it untouched.
 */
function asPathData(tag: string, attrs: LucideAttrs): string | null {
    if (tag === 'line') {
        const { x1, y1, x2, y2 } = attrs;
        if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null;
        return `M${x1} ${y1}L${x2} ${y2}`;
    }
    if (tag === 'polyline' || tag === 'polygon') {
        // `points` is whitespace/comma separated: "11 3 11 11 14 8".
        const nums = String(attrs.points ?? '').trim().split(/[\s,]+/).filter((s) => s !== '');
        if (nums.length < 4 || nums.length % 2 !== 0) return null;
        let d = `M${nums[0]} ${nums[1]}`;
        for (let i = 2; i < nums.length; i += 2) d += `L${nums[i]} ${nums[i + 1]}`;
        return tag === 'polygon' ? `${d}Z` : d;
    }
    return null;
}

/** Attrs consumed by `asPathData` — dropped from the emitted `<path>`. */
const GEOMETRY_ATTRS = new Set(['x1', 'y1', 'x2', 'y2', 'points']);

function renderElement(el: LucideElement): string {
    const [tag, attrs] = el;
    const pathData = asPathData(tag, attrs);
    if (pathData !== null) {
        // Carry over any attrs that aren't the geometry we just consumed —
        // stroke overrides and the like still apply to the path.
        const extra: string[] = [`d="${escapeAttr(pathData)}"`];
        for (const [k, v] of Object.entries(attrs)) {
            if (!GEOMETRY_ATTRS.has(k)) extra.push(`${k}="${escapeAttr(v)}"`);
        }
        return `<path ${extra.join(' ')}/>`;
    }
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
