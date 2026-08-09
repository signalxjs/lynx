/**
 * #951 — SigxWebEncodeGuardPlugin works around template-webpack-plugin >=
 * 0.14 crashing the web target: the async-template pass encodes every lazy
 * chunk group, and a group whose JS was deduplicated into the main chunk
 * reaches WebEncodePlugin with an empty manifest, which then throws
 * destructuring `last(Object.entries(manifest))`. The guard taps the same
 * beforeEncode waterfall earlier and stubs an inert background entry for
 * exactly that case.
 */
import { describe, it, expect } from 'vitest';

import { SigxWebEncodeGuardPlugin } from '../src/entry';

type GuardArgs = {
  encodeData: {
    sourceContent: { appType?: string };
    manifest: Record<string, string>;
  };
};

function runGuard(encodeData: GuardArgs['encodeData']): GuardArgs {
  let tapped: ((args: GuardArgs) => unknown) | undefined;
  const templatePlugin = {
    getLynxTemplatePluginHooks: () => ({
      beforeEncode: {
        tap: (_name: string, cb: (args: GuardArgs) => unknown) => {
          tapped = cb;
        },
      },
    }),
  };
  const plugin = new SigxWebEncodeGuardPlugin(templatePlugin);

  let compilationCb: ((compilation: unknown) => void) | undefined;
  plugin.apply({
    hooks: {
      thisCompilation: {
        tap: (_name: string, cb: (compilation: unknown) => void) => {
          compilationCb = cb;
        },
      },
    },
  } as never);

  compilationCb!({});
  const args: GuardArgs = { encodeData };
  tapped!(args);
  return args;
}

describe('SigxWebEncodeGuardPlugin (#951)', () => {
  it('stubs an inert background entry for an empty-manifest lazy bundle', () => {
    const args = runGuard({
      sourceContent: { appType: 'DynamicComponent' },
      manifest: {},
    });
    expect(Object.keys(args.encodeData.manifest)).toEqual([
      '/app-service.js',
    ]);
    expect(args.encodeData.manifest['/app-service.js']).toContain(
      'module.exports',
    );
  });

  it('leaves a lazy bundle with real background JS untouched', () => {
    const manifest = { 'lazy-bundle/x/background.js': 'real();' };
    const args = runGuard({
      sourceContent: { appType: 'DynamicComponent' },
      manifest: { ...manifest },
    });
    expect(args.encodeData.manifest).toEqual(manifest);
  });

  it('never touches the card (main template) even with an empty manifest', () => {
    const args = runGuard({
      sourceContent: { appType: 'card' },
      manifest: {},
    });
    expect(args.encodeData.manifest).toEqual({});
  });
});
