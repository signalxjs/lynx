/**
 * #664 — the dist emitter must append MT worklet-body registrations.
 *
 * The JS-target transform strips every `'main thread'` body to a `{_wkltId}`
 * placeholder. Snapshots get their LEPUS real-body registrations appended;
 * worklets must get the same treatment (guarded `registerWorkletInternal`
 * statements) or every `runOnMainThread` / MT event worklet in a templated
 * dist is structurally dead — the MT registry lookup returns undefined and
 * the invoke throws (found by #663's device gate).
 *
 * Runs the real script against a throwaway fixture package, then evaluates
 * the emitted registrations under both thread semantics.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../scripts/build-snapshot-dist.mjs',
);

const HELPER_SRC = `
import { runOnMainThread } from '@sigx/lynx';
export function makeScroller(ref: { current: { invoke(m: string, a: object): unknown } | null }) {
  return runOnMainThread((rowIndex: number, method: string) => {
    'main thread';
    const el = ref.current;
    if (!el || rowIndex < 0) return;
    el.invoke(method, { position: rowIndex, HELPER_BODY_MARKER: true });
  });
}
`;

const CELL_SRC = `
import { runOnMainThread } from '@sigx/lynx';
export function Cell(props: { label: string }) {
  const poke = runOnMainThread(() => {
    'main thread';
    return 'CELL_BODY_MARKER';
  });
  void poke;
  return <view><text text={props.label} /></view>;
}
`;

// Fixture emission happens in beforeAll — NOT at module scope: Vitest
// evaluates test modules during discovery, and spawning the build script
// there would run it even for filtered-out test runs.
let fixture = '';
let helper = '';
let cell = '';

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), 'sigx-dist-wklt-'));
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: '@sigx/fixture-dist' }));
  mkdirSync(join(fixture, 'src'), { recursive: true });
  writeFileSync(join(fixture, 'src', 'helper.ts'), HELPER_SRC);
  writeFileSync(join(fixture, 'src', 'Cell.tsx'), CELL_SRC);
  execFileSync(process.execPath, [SCRIPT], { cwd: fixture, stdio: 'pipe' });
  helper = readFileSync(join(fixture, 'dist', 'helper.js'), 'utf8');
  cell = readFileSync(join(fixture, 'dist', 'Cell.js'), 'utf8');
});
afterAll(() => { if (fixture) rmSync(fixture, { recursive: true, force: true }); });

/** The appended registration block (everything from the #664 banner on). */
function registrationBlock(dist: string): string {
  const at = dist.indexOf('// #664:');
  expect(at).toBeGreaterThan(-1);
  return dist.slice(at);
}

describe('dist emitter worklet registrations (#664)', () => {
  it('strips the body from module code but appends a guarded registration (.ts, no snapshots)', () => {
    const block = registrationBlock(helper);
    const moduleCode = helper.slice(0, helper.indexOf('// #664:'));
    // Module code carries only the placeholder…
    expect(moduleCode).toMatch(/_wkltId:\s*"/);
    expect(moduleCode).not.toContain('HELPER_BODY_MARKER');
    // …and the appended block re-registers the real body, guarded.
    expect(block).toMatch(/typeof registerWorkletInternal === 'function' && registerWorkletInternal\("main-thread"/);
    expect(block).toContain('HELPER_BODY_MARKER');
  });

  it('registration ids match the module placeholders', () => {
    for (const dist of [helper, cell]) {
      const placeholderIds = [...dist.matchAll(/_wkltId:\s*"([^"]+)"/g)].map((m) => m[1]);
      const registeredIds = [...registrationBlock(dist).matchAll(
        /registerWorkletInternal\("main-thread",\s*"([^"]+)"/g,
      )].map((m) => m[1]);
      expect(placeholderIds.length).toBeGreaterThan(0);
      for (const id of placeholderIds) expect(registeredIds).toContain(id);
    }
  });

  it('coexists with snapshot registrations in one templated file', () => {
    expect(cell).toContain('snapshotCreatorMap[');
    expect(registrationBlock(cell)).toContain('CELL_BODY_MARKER');
  });

  it('MT semantics: evaluating the block with the global registers a callable body', () => {
    const block = registrationBlock(helper);
    const registered: Array<{ kind: string; id: string; fn: (...args: unknown[]) => unknown }> = [];
    new Function(
      'registerWorkletInternal',
      block,
    )((kind: string, id: string, fn: (...args: unknown[]) => unknown) => {
      registered.push({ kind, id, fn });
    });
    expect(registered).toHaveLength(1);
    expect(registered[0]!.kind).toBe('main-thread');
    // The body executes against the transform's ctx-as-this contract.
    const invoked: unknown[] = [];
    const ctx = { _c: { ref: { current: { invoke: (...a: unknown[]) => invoked.push(a) } } } };
    registered[0]!.fn.call(ctx, 3, 'scrollToPosition');
    expect(invoked).toHaveLength(1);
    expect(invoked[0]).toEqual(['scrollToPosition', { position: 3, HELPER_BODY_MARKER: true }]);
  });

  it('BG/web semantics: without the global the block is a silent no-op', () => {
    expect(() => new Function(registrationBlock(helper))()).not.toThrow();
  });
});
