import type { CodepointMap, GlyphSvg, IconSetDef, SvgMap } from './types';

const runtimeCodepoints: CodepointMap = {};
const runtimeSvgs: SvgMap = {};

export function registerIconSet(def: IconSetDef): void {
    const codepoints: Record<string, number> = {};
    const svgs: Record<string, GlyphSvg> = {};
    for (const [name, g] of Object.entries(def.glyphs)) {
        if (g.codepoint !== undefined) codepoints[name] = g.codepoint;
        if (g.svg) svgs[name] = g.svg;
    }
    if (Object.keys(codepoints).length > 0) runtimeCodepoints[def.id] = codepoints;
    if (Object.keys(svgs).length > 0) runtimeSvgs[def.id] = svgs;
}

export function lookupCodepoint(
    buildTime: CodepointMap,
    set: string,
    name: string,
): number | undefined {
    return buildTime[set]?.[name] ?? runtimeCodepoints[set]?.[name];
}

export function lookupSvg(
    buildTime: SvgMap,
    set: string,
    name: string,
): GlyphSvg | undefined {
    return buildTime[set]?.[name] ?? runtimeSvgs[set]?.[name];
}

export function lookupGlyph(
    buildTimeCodepoints: CodepointMap,
    buildTimeSvgs: SvgMap,
    set: string,
    name: string,
): { codepoint?: number; svg?: GlyphSvg } | undefined {
    const svg = lookupSvg(buildTimeSvgs, set, name);
    if (svg) return { svg };

    const codepoint = lookupCodepoint(buildTimeCodepoints, set, name);
    if (codepoint !== undefined) return { codepoint };

    return undefined;
}
