import { readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildUnits, EXCLUDED, FOLD, groupUnits, GROUPS, META, renderBody, renderTitle } from '../lib/audit-units.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packagesDir = join(repoRoot, 'packages');

/** The real package list — the thing the generator must not drift from. */
const packageDirs = readdirSync(packagesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(packagesDir, e.name, 'package.json')))
    .map((e) => e.name);

describe('coverage of the real package tree', () => {
    it('classifies every package — none silently dropped', () => {
        const { unknown } = buildUnits(packageDirs);
        expect(unknown).toEqual([]);
    });

    it('covers every package exactly once — as a unit, a fold, or a stated exclusion', () => {
        const { units } = buildUnits(packageDirs);
        const covered = [
            ...units.flatMap((u) => [u.pkg, ...u.absorbs.map((a) => a.replace('@sigx/', ''))]),
            ...Object.keys(EXCLUDED),
        ];
        expect([...covered].sort()).toEqual([...packageDirs].sort());
        // Exactly once — a package appearing in two units would double-book an agent.
        expect(new Set(covered).size).toBe(covered.length);
    });

    it('gives every exclusion a reason', () => {
        // "Not audited" has to be a decision someone wrote down, not a gap.
        for (const [name, why] of Object.entries(EXCLUDED)) {
            expect(why, `${name} is excluded with no reason`).toBeTruthy();
        }
    });

    it('never both excludes a package and gives it metadata', () => {
        expect(Object.keys(EXCLUDED).filter((n) => n in META)).toEqual([]);
        expect(Object.keys(EXCLUDED).filter((n) => n in FOLD)).toEqual([]);
    });

    it('builds no unit for an excluded package', () => {
        const { units } = buildUnits(packageDirs);
        for (const name of Object.keys(EXCLUDED)) {
            expect(units.some((u) => u.pkg === name), `${name} should not be a unit`).toBe(false);
        }
    });

    it('folds only into packages that are themselves audit units', () => {
        const { units } = buildUnits(packageDirs);
        const unitPkgs = new Set(units.map((u) => u.pkg));
        for (const [from, into] of Object.entries(FOLD)) {
            expect(unitPkgs.has(into), `${from} folds into ${into}, which is not a unit`).toBe(true);
            expect(unitPkgs.has(from), `${from} is folded but also a unit`).toBe(false);
        }
    });

    it('yields one unit per package minus the folds and exclusions', () => {
        const { units } = buildUnits(packageDirs);
        expect(units).toHaveLength(
            packageDirs.length - Object.keys(FOLD).length - Object.keys(EXCLUDED).length,
        );
    });
});

describe('metadata', () => {
    it('assigns every unit to a known group', () => {
        const { units } = buildUnits(packageDirs);
        for (const u of units) {
            expect(Object.keys(GROUPS), `${u.name} has group "${u.group}"`).toContain(u.group);
        }
    });

    it('records a reason for every showcase exemption', () => {
        const { units } = buildUnits(packageDirs);
        for (const u of units.filter((x) => x.demo === 'exempt')) {
            expect(u.why, `${u.name} is exempt from the showcase requirement with no reason`).toBeTruthy();
        }
    });

    it('uses only the three known showcase states', () => {
        const { units } = buildUnits(packageDirs);
        for (const u of units) {
            expect(['yes', 'no', 'exempt'], `${u.name}`).toContain(u.demo);
        }
    });

    it('never both folds a package and gives it metadata', () => {
        // buildUnits treats a directory as classified if it is in either map,
        // so an overlap would silently carry contradictory config: metadata
        // for a package that never becomes a unit.
        const overlap = Object.keys(FOLD).filter((name) => name in META);
        expect(overlap).toEqual([]);
    });

    it('has no entry for a package that no longer exists', () => {
        const known = new Set(packageDirs);
        for (const [label, map] of [['META', META], ['FOLD', FOLD], ['EXCLUDED', EXCLUDED]]) {
            for (const name of Object.keys(map)) {
                expect(known.has(name), `${label} has "${name}", which is not a package directory`).toBe(true);
            }
        }
    });

    it('groups without losing a unit', () => {
        const { units } = buildUnits(packageDirs);
        const grouped = groupUnits(units).flatMap((g) => g.units);
        expect(grouped).toHaveLength(units.length);
    });
});

describe('renderBody', () => {
    const { units } = buildUnits(packageDirs);
    const unit = (name) => units.find((u) => u.pkg === name);

    it('gives every unit the sections the working protocol depends on', () => {
        for (const u of units) {
            const body = renderBody(u, 857);
            expect(body, u.name).toContain('## Findings');
            expect(body, u.name).toContain('## Design questions (blocked)');
            expect(body, u.name).toContain('## Exit criteria');
            expect(body, u.name).toContain('## Device verification');
            expect(body, u.name).toContain('Part of the epic #857');
            // The rubric table must be complete — a missing dimension is a
            // dimension nobody grades.
            for (const d of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']) {
                expect(body, `${u.name} is missing ${d}`).toContain(`| **${d}** |`);
            }
        }
    });

    it('tells PR authors not to auto-close the issue', () => {
        // The whole design rests on this: one issue, many PRs.
        expect(renderBody(unit('lynx-clipboard'), 857)).toContain('never `Closes`');
    });

    it('names the absorbed packages when a unit folds others in', () => {
        const icons = renderBody(unit('lynx-icons'), 857);
        expect(icons).toContain('@sigx/lynx-icons-fa-free');
        expect(icons).toContain('@sigx/lynx-icons-lucide');
    });

    it('states the showcase requirement according to the unit state', () => {
        expect(renderBody(unit('lynx-clipboard'), 857)).toContain('no screen exists');
        expect(renderBody(unit('lynx-camera'), 857)).toContain('a screen exists');
        const testing = renderBody(unit('lynx-testing'), 857);
        expect(testing).toContain('exempt');
        expect(testing).toContain(META['lynx-testing'].why);
    });

    it('carries the D4 peer where one is named', () => {
        expect(renderBody(unit('lynx-storage'), 857)).toContain('async-storage');
        // No peer named → no dangling "compare against ``" line.
        expect(renderBody(unit('lynx-motion'), 857)).not.toContain('D4 peer to compare against');
    });

    it('includes the pre-audit seeds so an agent starts from evidence', () => {
        const biometric = renderBody(unit('lynx-biometric'), 857);
        expect(biometric).toContain('What the pre-audit already found');
        expect(biometric).toContain('src/biometric.ts:88');
    });
});

describe('renderTitle', () => {
    it('is stable and greppable, so re-runs can skip existing issues', () => {
        const { units } = buildUnits(packageDirs);
        const titles = units.map(renderTitle);
        expect(titles).toContain('Module review: @sigx/lynx-camera');
        expect(new Set(titles).size).toBe(titles.length);
        for (const t of titles) expect(t.startsWith('Module review: ')).toBe(true);
    });
});
