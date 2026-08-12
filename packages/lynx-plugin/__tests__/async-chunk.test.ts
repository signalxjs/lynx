/**
 * #1015 — SigxAsyncChunkPlugin keeps dynamic `import()` on the
 * `lynx.requireModuleAsync` path that sigx's native resource fetchers actually
 * serve (#599/#612), instead of `@lynx-js/template-webpack-plugin` >= 0.14's
 * lazy-bundle path.
 *
 * Three separate things have to hold, and each has its own failure mode:
 *
 *  1. `__webpack_require__.lynx_aci` ends up empty, so the chunk-loading
 *     runtime never reaches `lynx.loadLazyBundle` — a method `@lynx-js/react`
 *     installs as a module side effect and sigx therefore never defines. It ran
 *     during bundle evaluation, so one unreachable chunk blanked the whole app.
 *  2. The reset runtime module sorts *after* the one that populates the map.
 *  3. Lazy-bundle templates get an inert manifest, so `LynxEncodePlugin` does
 *     not inline the real async chunks into them and delete the standalone
 *     files — which is what emptied `dist/static/js/async/`.
 *
 * (3) also subsumes the old web-only empty-manifest guard (#951).
 */
import { describe, it, expect } from 'vitest';

import { SigxAsyncChunkPlugin } from '../src/entry';

type EncodeData = {
  sourceContent: { appType?: string };
  manifest: Record<string, string>;
};
type GuardArgs = { encodeData: EncodeData };

const LYNX_ASYNC_CHUNK_IDS = '__webpack_require__.lynx_aci';

interface Harness {
  /** Runs the `beforeEncode` tap over an encodeData payload. */
  encode(data: EncodeData): GuardArgs;
  /** Source of every runtime module the plugin registered, with its stage. */
  runtimeModules: { stage: number; source: string }[];
  /** The runtime global the plugin tapped `runtimeRequirementInTree` for. */
  requirement: string | undefined;
  /** How many runtime modules were added for a single repeated chunk. */
  addCount: number;
}

// Rest parameter, not a default: `run(undefined)` must be able to mean "the
// original chunkFilename really is undefined", which a default value swallows.
function run(...init: [] | [unknown] | [unknown, unknown]): Harness {
  const initialChunkFilename = init.length > 0
    ? init[0]
    : 'static/js/async/[name].js';
  // What replaces chunkFilename between `environment` and `afterEnvironment`.
  const between = init.length > 1 ? init[1] : undefined;
  let beforeEncodeCb: ((args: GuardArgs) => unknown) | undefined;
  const templatePlugin = {
    getLynxTemplatePluginHooks: () => ({
      beforeEncode: {
        tap: (_n: string, cb: (args: GuardArgs) => unknown) => {
          beforeEncodeCb = cb;
        },
      },
    }),
  };

  // Minimal stand-in for rspack's RuntimeModule: records name + stage and
  // exposes generate(). STAGE_TRIGGER is rspack's real value.
  const STAGE_TRIGGER = 20;
  class FakeRuntimeModule {
    constructor(public name: string, public stage = 0) {}
    generate(): string {
      return '';
    }
    static STAGE_TRIGGER = STAGE_TRIGGER;
  }

  let requirement: string | undefined;
  let requirementCb:
    | ((chunk: object, set: Set<string>) => void)
    | undefined;
  const added: object[] = [];
  const runtimeModules: { stage: number; source: string }[] = [];

  const compilation = {
    hooks: {
      runtimeRequirementInTree: {
        for: (global: string) => {
          requirement = global;
          return {
            tap: (_n: string, cb: (chunk: object, set: Set<string>) => void) => {
              requirementCb = cb;
            },
          };
        },
      },
    },
    addRuntimeModule: (_chunk: object, mod: FakeRuntimeModule) => {
      added.push(mod);
      runtimeModules.push({ stage: mod.stage, source: mod.generate() });
    },
  };

  let thisCompilationCb: ((c: unknown) => void) | undefined;
  let environmentCb: (() => void) | undefined;
  let afterEnvironmentCb: (() => void) | undefined;

  const compiler = {
    webpack: { RuntimeModule: FakeRuntimeModule },
    options: { output: { chunkFilename: initialChunkFilename } },
    hooks: {
      thisCompilation: {
        tap: (_n: string, cb: (c: unknown) => void) => {
          thisCompilationCb = cb;
        },
      },
      environment: {
        tap: (_n: string, cb: () => void) => {
          environmentCb = cb;
        },
      },
      afterEnvironment: {
        tap: (_n: string, cb: () => void) => {
          afterEnvironmentCb = cb;
        },
      },
    },
  };

  new SigxAsyncChunkPlugin(templatePlugin).apply(compiler as never);

  // Between the two hooks, something replaces chunkFilename. By default that
  // is the template plugin's lazy-bundle rewrite (always a function).
  environmentCb!();
  compiler.options.output.chunkFilename = (between ?? (() =>
    'lazy-bundle/x.js')) as never;
  afterEnvironmentCb!();

  thisCompilationCb!(compilation);

  // Same chunk twice — adding a runtime module re-enters requirement processing.
  const chunk = {};
  requirementCb!(chunk, new Set());
  requirementCb!(chunk, new Set());

  return {
    encode: (data) => {
      const args: GuardArgs = { encodeData: data };
      beforeEncodeCb!(args);
      return args;
    },
    runtimeModules,
    requirement,
    addCount: added.length,
    // exposed for the chunkFilename assertion
    ...({ chunkFilename: compiler.options.output.chunkFilename } as object),
  } as Harness & { chunkFilename: unknown };
}

describe('SigxAsyncChunkPlugin — lynx_aci reset (#1015)', () => {
  it('taps the lynx async-chunk-ids runtime global', () => {
    expect(run().requirement).toBe(LYNX_ASYNC_CHUNK_IDS);
  });

  it('emits a runtime module that empties the async-chunk id map', () => {
    const [mod] = run().runtimeModules;
    // An empty map is what routes every chunk to lynx.requireModuleAsync.
    expect(mod!.source).toContain(`${LYNX_ASYNC_CHUNK_IDS} = {}`);
  });

  it('sorts the reset after the map it overwrites', () => {
    // The template plugin registers its populating module at rspack's
    // STAGE_ATTACH (10); runtime modules concatenate in stage order, so the
    // reset must be later or the populated map wins and loadLazyBundle is
    // called again.
    const RSPACK_STAGE_ATTACH = 10;
    expect(run().runtimeModules[0]!.stage).toBeGreaterThan(
      RSPACK_STAGE_ATTACH,
    );
  });

  it('adds the reset only once per chunk', () => {
    expect(run().addCount).toBe(1);
  });

  it('restores the chunkFilename the template plugin repointed', () => {
    // Without this the async chunk is emitted under lazy-bundle/ and never
    // lands in dist/static/js/async/ for embedAsyncAssets to pick up.
    const h = run() as Harness & { chunkFilename: unknown };
    expect(h.chunkFilename).toBe('static/js/async/[name].js');
  });

  it('restores an original of undefined rather than keeping the rewrite', () => {
    // `undefined` is a meaningful original — it means "let rspack apply its own
    // default". Gating the restore on the *value* instead of on having captured
    // it would leave the template plugin's lazy-bundle rewrite in place here.
    const h = run(undefined) as Harness & { chunkFilename: unknown };
    expect(h.chunkFilename).toBeUndefined();
  });

  it('leaves a plain template another plugin deliberately set', () => {
    // The lazy-bundle rewrite is always a function. A string means someone else
    // set chunkFilename on purpose after us and there is no rewrite left to
    // undo — stamping our captured value over it would discard their choice.
    const h = run(
      'static/js/async/[name].js',
      'custom/[name].js',
    ) as Harness & { chunkFilename: unknown };
    expect(h.chunkFilename).toBe('custom/[name].js');
  });
});

describe('SigxAsyncChunkPlugin — lazy-bundle manifest (#1015, supersedes #951)', () => {
  it('replaces a lazy bundle manifest so its real chunks are not absorbed', () => {
    // LynxEncodePlugin inlines every manifest entry of a DynamicComponent and
    // then deletes the standalone asset. Stubbing keeps the real file on disk.
    const args = run().encode({
      sourceContent: { appType: 'DynamicComponent' },
      manifest: { 'lazy-bundle/x/background.js': 'real();' },
    });
    expect(Object.keys(args.encodeData.manifest)).toEqual([
      '/app-service.js',
    ]);
    expect(args.encodeData.manifest['/app-service.js']).toContain(
      'module.exports',
    );
  });

  it('stubs an empty-manifest lazy bundle too (#951 web crash)', () => {
    const args = run().encode({
      sourceContent: { appType: 'DynamicComponent' },
      manifest: {},
    });
    expect(Object.keys(args.encodeData.manifest)).toEqual([
      '/app-service.js',
    ]);
  });

  it('never touches the card (main template)', () => {
    const manifest = { '/app-service.js': 'real();' };
    const args = run().encode({
      sourceContent: { appType: 'card' },
      manifest: { ...manifest },
    });
    expect(args.encodeData.manifest).toEqual(manifest);
  });
});
