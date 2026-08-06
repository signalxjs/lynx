/**
 * The band table is the single source of truth for FLIK's rules, so these
 * tests assert the properties the ruleset leans on rather than the specific
 * fractions — retuning the bands must not require rewriting them.
 */

import { describe, it, expect } from 'vitest';

import {
    BANDS,
    bandRect,
    homeZoneOf,
    launchDirection,
    ownerOfHome,
    ownerOfTarget,
    targetZoneOf,
    zoneOf,
} from '../board';
import { PLAYER_A, PLAYER_B } from '../types';

const H = 1000;

describe('band table', () => {
    it('covers [0, 1) with no gaps or overlaps', () => {
        expect(BANDS[0]!.from).toBe(0);
        expect(BANDS[BANDS.length - 1]!.to).toBe(1);
        for (let i = 1; i < BANDS.length; i++) {
            expect(BANDS[i]!.from).toBe(BANDS[i - 1]!.to);
        }
    });

    it('orders the bands so each player shoots across the field at the far target', () => {
        const order = BANDS.map((b) => b.zone);
        expect(order).toEqual(['homeB', 'targetA', 'field', 'targetB', 'homeA']);
        // The load-bearing property: a player's target is nearer the OPPONENT's
        // home than their own, so overshooting reaches the opponent's home.
        expect(order.indexOf('targetA')).toBeLessThan(order.indexOf('homeA'));
        expect(order.indexOf('targetB')).toBeGreaterThan(order.indexOf('homeB'));
    });
});

describe('zoneOf', () => {
    it('maps each band to itself at its midpoint', () => {
        for (const band of BANDS) {
            const mid = ((band.from + band.to) / 2) * H;
            expect(zoneOf(mid, H)).toBe(band.zone);
        }
    });

    it('is half-open: a boundary belongs to the band below it', () => {
        expect(zoneOf(0.13 * H, H)).toBe('targetA');
        expect(zoneOf(0.13 * H - 0.001, H)).toBe('homeB');
    });

    it('clamps the extremes rather than returning undefined', () => {
        expect(zoneOf(0, H)).toBe('homeB');
        expect(zoneOf(H, H)).toBe('homeA');
        expect(zoneOf(H * 2, H)).toBe('homeA');
        expect(zoneOf(-50, H)).toBe('homeB');
    });

    it('degrades to field on a zero-height board rather than dividing by zero', () => {
        expect(zoneOf(10, 0)).toBe('field');
    });
});

describe('ownership helpers', () => {
    it('gives each player a home and a target at opposite ends', () => {
        expect(homeZoneOf(PLAYER_A)).toBe('homeA');
        expect(targetZoneOf(PLAYER_A)).toBe('targetA');
        expect(homeZoneOf(PLAYER_B)).toBe('homeB');
        expect(targetZoneOf(PLAYER_B)).toBe('targetB');
    });

    it('round-trips zone to owner', () => {
        expect(ownerOfHome('homeA')).toBe(PLAYER_A);
        expect(ownerOfHome('homeB')).toBe(PLAYER_B);
        expect(ownerOfHome('field')).toBeNull();
        expect(ownerOfHome('targetA')).toBeNull();
        expect(ownerOfTarget('targetA')).toBe(PLAYER_A);
        expect(ownerOfTarget('targetB')).toBe(PLAYER_B);
        expect(ownerOfTarget('homeA')).toBeNull();
    });

    it('shoots A upward and B downward', () => {
        expect(launchDirection(PLAYER_A)).toBe(-1);
        expect(launchDirection(PLAYER_B)).toBe(1);
    });
});

describe('bandRect', () => {
    it('spans the full width at the band offset', () => {
        const r = bandRect('targetB', 400, H);
        expect(r).toEqual({ x: 0, y: 0.7 * H, width: 400, height: (0.87 - 0.7) * H });
    });
});
