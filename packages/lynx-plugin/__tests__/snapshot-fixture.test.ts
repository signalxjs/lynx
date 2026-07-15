/**
 * Transform-contract tripwire (#630): runs the upstream WASM snapshot
 * transform against fixture JSX and asserts the emitted shape matches what
 * sigx's jsx wrapper + BG renderer consume. A @lynx-js/react upgrade that
 * changes any of these shapes fails here first — treat such a failure as a
 * deliberate migration, not a flaky test.
 */

import { describe, expect, it } from 'vitest';
import { transformReactLynxSync } from '@lynx-js/react/transform';

function lower(src: string, target: 'LEPUS' | 'JS'): string {
  const result = transformReactLynxSync(src, {
    filename: 'Fixture.tsx',
    pluginName: 'sigx:test',
    sourcemap: false,
    cssScope: false,
    directiveDCE: false,
    defineDCE: false,
    shake: false,
    compat: false,
    refresh: false,
    worklet: { target, filename: 'Fixture.tsx', runtimePkg: '@sigx/lynx' },
    snapshot: {
      preserveJsx: false,
      runtimePkg: '@sigx/lynx/internal',
      jsxImportSource: '@sigx/lynx',
      filename: 'Fixture.tsx',
      target,
    },
  });
  expect(result.errors ?? []).toEqual([]);
  return result.code;
}

const FIXTURE = `
export function Cell({ glyph, name, onTap }) {
  return (
    <view class="cell" bindtap={onTap}>
      <text class="glyph">{glyph}</text>
      <text class="name">{name}</text>
    </view>
  );
}
`;

describe('snapshot transform contract', () => {
  it('emits sigx-targeted registrations and slot-prop jsx calls (LEPUS)', () => {
    const code = lower(FIXTURE, 'LEPUS');
    // Registration shape the MT loader extracts and the registry consumes.
    expect(code).toContain('from "@sigx/lynx/internal"');
    expect(code).toMatch(/\w+\.snapshotCreatorMap\[__snapshot_\w+_\w+_\d+\] = \(__snapshot_\w+_\w+_\d+\)=>\w+\.createSnapshot\(/);
    // The create body drives the element PAPI directly.
    expect(code).toContain('__CreateView(');
    expect(code).toContain('__SetClasses(');
    // JSX lowers to the wrapper contract: values array + $N slot props.
    expect(code).toContain('from "@sigx/lynx/jsx-runtime"');
    expect(code).toMatch(/values: \[/);
    expect(code).toMatch(/\$0: glyph/);
    expect(code).toMatch(/\$1: name/);
  });

  it('nulls create/update on the JS target but keeps slot metadata', () => {
    const code = lower(FIXTURE, 'JS');
    expect(code).toMatch(/createSnapshot\([^,]+, null, null,/);
    expect(code).toContain('__DynamicPartSlotV2');
    // Event hole carries the real handler on the BG side.
    expect(code).toMatch(/values: \[\s*onTap/);
  });

  it('produces identical uniqIDs across LEPUS and JS targets', () => {
    const ids = (code: string): string[] =>
      [...code.matchAll(/__snapshot_\w+_\w+_\d+/g)].map((m) => m[0]).sort();
    const lepus = new Set(ids(lower(FIXTURE, 'LEPUS')));
    const js = new Set(ids(lower(FIXTURE, 'JS')));
    expect([...lepus]).toEqual([...js]);
    expect(lepus.size).toBeGreaterThan(0);
  });
});
