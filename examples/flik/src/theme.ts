/**
 * FLIK's palette, as plain values rather than CSS custom properties.
 *
 * Deliberate: theme `var(--color-*)` used from an inline style paints
 * transparent on Lynx (custom properties only resolve from CSS-rule
 * declarations at first paint), and the board is almost entirely inline
 * geometry. Hex strings avoid the whole class of problem, and a game with one
 * fixed look has nothing to gain from a theme system.
 */

export const COLORS = {
    /** Page behind the board. */
    backdrop: '#0B1020',
    /** The playing surface. */
    felt: '#131A31',
    /** Board edge and band separators. */
    line: '#243154',

    /** Player A — warm, bottom of the board. */
    a: '#F97362',
    aDim: 'rgba(249, 115, 98, 0.14)',
    /** Player B — cool, top of the board. */
    b: '#4CC9F0',
    bDim: 'rgba(76, 201, 240, 0.14)',

    text: '#E8EDFB',
    textDim: '#8391B8',
    /** An ember pip that has been spent. */
    emberOut: '#3A4568',
} as const;

/** Colour of a player's discs and chrome. */
export function colorOf(owner: 0 | 1): string {
    return owner === 0 ? COLORS.a : COLORS.b;
}

/** Wash used to tint a player's home and target bands. */
export function dimColorOf(owner: 0 | 1): string {
    return owner === 0 ? COLORS.aDim : COLORS.bDim;
}
