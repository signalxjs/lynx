/**
 * Route-sheet detent policy — the navigator's thin layer over
 * `@sigx/lynx-sheet`'s shared detent model (which owns spec parsing,
 * px/fraction resolution, clamping and the half-screen default).
 *
 * Everything sheet-positional in this package is in **reveal px** (visible
 * height; 0 = off-screen): the resolved detents here feed the dedicated
 * `sheetReveal` SharedValue, the layer translateY mapping, and the drag
 * engine's geometry.
 */
import { resolveDetents, type DetentEnv, type DetentSpec } from '@sigx/lynx-sheet';
import { screenHeight } from './screen-width.js';

/**
 * Environment route detents resolve against. Route sheets are full-screen
 * overlays anchored to the physical screen bottom and declare no keyboard
 * detents today — the env is spelled out (rather than defaulted away) so
 * the insets/keyboard hooks have an obvious place to land later.
 *
 * Built per call, not held as a module constant: `screenHeight()` follows
 * rotation, and a snapshot taken at import time would pin every route sheet
 * to the launch orientation (#856).
 */
export function routeDetentEnv(): DetentEnv {
    return {
        screenH: screenHeight(),
        topOffset: 0,
        bottomInset: 0,
        keyboardPx: 0,
    };
}

/**
 * Resolve a screen's declared detents to ascending px heights (default:
 * half the screen, matching the shared model's fallback).
 */
export function resolveRouteDetents(
    specs: readonly DetentSpec[] | undefined,
): number[] {
    return resolveDetents(specs, routeDetentEnv());
}

/** Resolve the initial rest reveal (px) from config (default: most open). */
export function initialDetentPx(
    detentsPx: readonly number[],
    initialDetentIndex: number | undefined,
): number {
    const idx =
        initialDetentIndex != null &&
        initialDetentIndex >= 0 &&
        initialDetentIndex < detentsPx.length
            ? initialDetentIndex
            : detentsPx.length - 1;
    return detentsPx[idx];
}
