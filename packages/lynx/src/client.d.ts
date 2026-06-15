// Client-side ambient types for apps built on `@sigx/lynx`.
//
// Apps opt in via a one-line `env.d.ts` at their source root:
//
//     /// <reference types="@sigx/lynx/client" />
//
// This mirrors the `vite/client` / `next/types/global` pattern: a single
// reference unlocks the bundler/HMR surface that every lynx app needs, so
// the ambient declarations don't have to be duplicated in every project.

// Side-effect imports of CSS assets, e.g. `import './styles.css'`. The lynx
// dev/build pipeline (rspeedy/rsbuild) handles these at bundle time, but TS
// under `moduleResolution: "bundler"` still needs a declaration for the
// module shape.
declare module '*.css';

// Platform build-time defines, folded to literals per rspeedy environment by
// `@sigx/lynx-plugin`. Branch on these for tree-shakeable platform code:
// `if (__WEB__) { … }` drops the dead branch from the other bundle (unlike the
// runtime `Platform.OS`, which keeps both). `__NATIVE__` is always `!__WEB__`.
declare const __WEB__: boolean;
declare const __NATIVE__: boolean;

// The webpack/rspeedy HMR `module.hot` global. We type only the surface lynx
// apps actually use (`accept` / `dispose`) to keep the ambient minimal and
// avoid pulling in `@types/webpack-env` or `@types/node`.
declare const module: {
    readonly hot?: {
        accept(): void;
        accept(dependency: string | string[], callback?: () => void): void;
        dispose(callback: (data: unknown) => void): void;
    };
};
