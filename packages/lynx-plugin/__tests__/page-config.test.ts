/**
 * #116 — SigxPageConfigPlugin merges extra page-config keys (notably
 * `enableCSSInlineVariables`) into the template's `sourceContent.config` via
 * LynxTemplatePlugin's `beforeEncode` hook, so the tasm encoder carries them
 * into the bundle for the native decoder (Lynx ≥ 3.6).
 */
import { describe, it, expect } from 'vitest';

import { SigxPageConfigPlugin } from '../src/entry';

type BeforeEncodeArgs = {
  encodeData: { sourceContent: { config: Record<string, unknown> } };
};

function runPlugin(
  config: Record<string, unknown>,
  initial: Record<string, unknown>,
): BeforeEncodeArgs {
  let tapped: ((args: BeforeEncodeArgs) => unknown) | undefined;
  const templatePlugin = {
    getLynxTemplatePluginHooks: () => ({
      beforeEncode: {
        tap: (_name: string, cb: (args: BeforeEncodeArgs) => unknown) => {
          tapped = cb;
        },
      },
    }),
  };
  const plugin = new SigxPageConfigPlugin(templatePlugin, config);

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
  const args: BeforeEncodeArgs = {
    encodeData: { sourceContent: { config: initial } },
  };
  tapped!(args);
  return args;
}

describe('SigxPageConfigPlugin (#116)', () => {
  it('merges enableCSSInlineVariables into sourceContent.config', () => {
    const args = runPlugin(
      { enableCSSInlineVariables: true },
      { enableCSSInheritance: false },
    );
    expect(args.encodeData.sourceContent.config).toEqual({
      enableCSSInheritance: false,
      enableCSSInlineVariables: true,
    });
  });

  it('its keys win over same-named keys already in the config', () => {
    const args = runPlugin(
      { enableCSSInlineVariables: true },
      { enableCSSInlineVariables: false, other: 1 },
    );
    expect(args.encodeData.sourceContent.config.enableCSSInlineVariables).toBe(
      true,
    );
    expect(args.encodeData.sourceContent.config.other).toBe(1);
  });

  it('an explicit false overrides a pre-existing true (kill switch)', () => {
    const args = runPlugin(
      { enableCSSInlineVariables: false },
      { enableCSSInlineVariables: true },
    );
    expect(args.encodeData.sourceContent.config.enableCSSInlineVariables).toBe(
      false,
    );
  });
});

describe('enableNewSticky (#950)', () => {
  it('carries the resolved boolean, so an engine default flip cannot change sticky layout', () => {
    // Upstream ships enableNewSticky OFF by default. We encode `false`
    // explicitly rather than omitting the key, so a future engine that flips
    // its own default does not silently relayout our sticky headers.
    const args = runPlugin(
      { enableCSSInlineVariables: true, enableNewSticky: false },
      {},
    );
    expect(args.encodeData.sourceContent.config).toEqual({
      enableCSSInlineVariables: true,
      enableNewSticky: false,
    });
  });

  it('opts in when set', () => {
    const args = runPlugin({ enableNewSticky: true }, {});
    expect(args.encodeData.sourceContent.config.enableNewSticky).toBe(true);
  });

  it('overrides a pre-existing value in the config', () => {
    const args = runPlugin({ enableNewSticky: false }, { enableNewSticky: true });
    expect(args.encodeData.sourceContent.config.enableNewSticky).toBe(false);
  });
});
