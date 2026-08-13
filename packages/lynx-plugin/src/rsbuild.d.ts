/**
 * Ambient declarations for the optional build plugins this package peers on.
 *
 * `@rsbuild/core` is deliberately NOT declared here. It used to be, with
 * hand-written minimal types, and because this file is inside the root
 * tsconfig's `include` that declaration shadowed the real package across the
 * whole repo — `CHAIN_ID` and `chain` were `any`, so nothing about the bundler
 * API was ever type-checked. It is a devDependency now; the real types apply.
 *
 * The two below stay: they are genuinely optional peers that may be absent
 * from a consumer's install, and TypeScript needs *something* to resolve.
 */

declare module '@lynx-js/template-webpack-plugin' {
  export class LynxTemplatePlugin {
    static defaultOptions: Record<string, unknown>;
    static getLynxTemplatePluginHooks(compilation: any): any;
    constructor(options?: Record<string, unknown>);
    apply(compiler: any): void;
  }
  export class LynxEncodePlugin {
    constructor(options?: Record<string, unknown>);
    apply(compiler: any): void;
  }
  export class WebEncodePlugin {
    constructor(options?: Record<string, unknown>);
    apply(compiler: any): void;
  }
}

declare module '@lynx-js/css-extract-webpack-plugin' {
  export interface CssExtractRspackPluginOptions {
    enableRemoveCSSScope?: boolean;
    enableCSSSelector?: boolean;
    enableCSSInvalidation?: boolean;
    cssPlugins?: any[];
    [key: string]: any;
  }
  // No `CssExtractWebpackPlugin`: 0.8.0 dropped webpack support and deleted it.
  // Declaring it here would re-hide that from the typechecker.
  export class CssExtractRspackPlugin {
    constructor(options?: CssExtractRspackPluginOptions);
    static loader: string;
  }
}
