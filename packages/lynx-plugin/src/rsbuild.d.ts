/**
 * Minimal type declarations for @rsbuild/core used by the plugin.
 * Avoids requiring @rsbuild/core as a devDependency — it's a peerDep
 * provided by the consuming project.
 *
 * TODO: Replace with proper @rsbuild/core types when available in workspace.
 */
declare module '@rsbuild/core' {
  export interface RsbuildPlugin {
    name: string;
    pre?: string[];
    setup: (api: RsbuildPluginAPI) => void;
  }

  export interface RsbuildPluginAPI {
    modifyRsbuildConfig: (
      fn: (
        config: Record<string, any>,
        utils: { mergeRsbuildConfig: (...configs: any[]) => any },
      ) => any,
    ) => void;
    modifyBundlerChain: (
      fn: (
        chain: any,
        utils: { environment: any; isDev: boolean; isProd: boolean; CHAIN_ID: any },
      ) => void | Promise<void>,
    ) => void;
    modifyRspackConfig: (fn: (config: any) => any) => void;
    getRsbuildConfig: (type?: string) => any;
    context: {
      callerName: string;
      bundlerType: string;
      /** Absolute path to the project root (the dir containing the rsbuild config). */
      rootPath: string;
    };
    expose: (key: symbol, value: any) => void;
    useExposed: (key: symbol) => any;
    /** Console-style logger exposed by rsbuild. */
    logger: {
      info(...args: unknown[]): void;
      warn(...args: unknown[]): void;
      error(...args: unknown[]): void;
      debug(...args: unknown[]): void;
    };
    /** Dev-server lifecycle hook fired after the dev server starts. */
    onAfterStartDevServer: (cb: () => void | Promise<void>) => void;
    /** Dev-server lifecycle hook fired when the dev server stops. */
    onCloseDevServer: (cb: () => void | Promise<void>) => void;
    /** Process-exit hook (Ctrl-C / termination). */
    onExit: (cb: () => void) => void;
  }

  /** Minimal CSSLoaderOptions type for css-loader configuration. */
  export interface CSSLoaderOptions {
    modules?: boolean | string | Record<string, any>;
    [key: string]: any;
  }

  /** Minimal Rspack namespace for loader context and rule types. */
  export namespace Rspack {
    interface LoaderContext {
      cacheable(flag: boolean): void;
      [key: string]: any;
    }
    type RuleSetRule = Record<string, any>;
  }
}

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
  export interface CssExtractWebpackPluginOptions {
    enableRemoveCSSScope?: boolean;
    enableCSSSelector?: boolean;
    enableCSSInvalidation?: boolean;
    cssPlugins?: any[];
    [key: string]: any;
  }
  export class CssExtractRspackPlugin {
    constructor(options?: CssExtractRspackPluginOptions);
    static loader: string;
  }
  export class CssExtractWebpackPlugin {
    constructor(options?: CssExtractWebpackPluginOptions);
    static loader: string;
  }
}
