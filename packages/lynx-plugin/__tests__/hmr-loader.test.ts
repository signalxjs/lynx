/**
 * Tests for the HMR loader's source transformation.
 *
 * The loader is an rspack string→string transform. We test it by calling
 * the exported function directly with a mock LoaderContext and verifying
 * the returned source string.
 */

import { describe, it, expect } from 'vitest';
import hmrLoader from '../src/loaders/hmr-loader';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock of Rspack.LoaderContext. */
function createCtx(resourcePath: string) {
  return {
    resourcePath,
    cacheable: () => {},
  } as any;
}

/** Run the loader on `source` with the given `resourcePath`. */
function transform(source: string, resourcePath = '/app/src/App.tsx') {
  return hmrLoader.call(createCtx(resourcePath), source);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hmr-loader', () => {
  it('should not transform files without component() calls', () => {
    const source = `export const foo = 'bar';`;
    expect(transform(source)).toBe(source);
  });

  it('should inject HMR preamble and footer for component files', () => {
    const source = `import { component } from '@sigx/lynx';\nconst App = component(() => () => <view />);\nexport default App;`;
    const result = transform(source);

    expect(result).toContain(`import { __registerComponentPlugin, __setCurrentInstanceForHMR } from '@sigx/lynx'`);
    expect(result).toContain(`import { initHMR, registerHMRModule } from '@sigx/lynx-runtime/hmr'`);
    expect(result).toContain(`initHMR(__registerComponentPlugin, __setCurrentInstanceForHMR)`);
    expect(result).toContain(`registerHMRModule(`);
    expect(result).toContain(`module.hot.accept()`);
  });

  describe('signal preservation', () => {
    it('should rename signal import and inject wrapper when signal is imported', () => {
      const source = [
        `import { signal, component } from '@sigx/lynx';`,
        `export const count = signal(0);`,
        `const App = component(() => () => <view>{count.value}</view>);`,
        `export default App;`,
      ].join('\n');

      const result = transform(source);

      // Original `signal` import should be renamed
      expect(result).toContain(`signal as __origSignal`);
      // The wrapper function should be defined
      expect(result).toContain(`function signal()`);
      expect(result).toContain(`__origSignal.apply`);
      // module.hot.dispose should save signals
      expect(result).toContain(`module.hot.dispose`);
      expect(result).toContain(`__hmrSigs`);
      expect(result).toContain(`__hmrSigStore`);
    });

    it('should NOT inject signal wrapper when signal is not imported', () => {
      const source = [
        `import { component } from '@sigx/lynx';`,
        `const App = component(() => () => <view />);`,
        `export default App;`,
      ].join('\n');

      const result = transform(source);

      // No signal wrapper
      expect(result).not.toContain(`__origSignal`);
      expect(result).not.toContain(`__hmrSigStore`);
      // But still has HMR infrastructure
      expect(result).toContain(`module.hot.accept()`);
    });

    it('should handle signal as the only import', () => {
      const source = [
        `import { signal } from '@sigx/lynx';`,
        `import { component } from '@sigx/lynx';`,
        `const route = signal({ page: 'home' });`,
        `const App = component(() => () => <view />);`,
      ].join('\n');

      const result = transform(source);

      expect(result).toContain(`signal as __origSignal`);
      expect(result).toContain(`function signal()`);
    });

    it('should handle signal import with double quotes', () => {
      const source = [
        `import { signal, component } from "@sigx/lynx";`,
        `const count = signal(0);`,
        `const App = component(() => () => <view />);`,
      ].join('\n');

      const result = transform(source);

      expect(result).toContain(`signal as __origSignal`);
      expect(result).toContain(`from "@sigx/lynx"`);
    });

    it('should preserve other named imports alongside signal', () => {
      const source = [
        `import { signal, component, computed } from '@sigx/lynx';`,
        `const count = signal(0);`,
        `const App = component(() => () => <view />);`,
      ].join('\n');

      const result = transform(source);

      // signal is renamed but component and computed remain
      expect(result).toContain(`signal as __origSignal`);
      expect(result).toContain(`component`);
      expect(result).toContain(`computed`);
    });

    it('should produce wrapper with correct module.hot.data flow', () => {
      const source = [
        `import { signal, component } from '@sigx/lynx';`,
        `export const currentRoute = signal({ name: 'home' });`,
        `const App = component(() => () => <view />);`,
      ].join('\n');

      const result = transform(source);

      // The wrapper reads from previous data
      expect(result).toContain(`module.hot.data.__hmrSigs`);
      // The wrapper stores signals
      expect(result).toContain(`__hmrSigStore[k]`);
      // Dispose handler saves the store
      expect(result).toContain(`data.__hmrSigs = __hmrSigStore`);
    });
  });

  it('should normalize Windows paths in module ID', () => {
    const source = `import { component } from '@sigx/lynx';\nconst A = component(() => () => null);`;
    const result = transform(source, 'C:\\app\\src\\App.tsx');

    expect(result).toContain(`registerHMRModule("C:/app/src/App")`);
  });
});
