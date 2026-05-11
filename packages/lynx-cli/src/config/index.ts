export { defineLynxConfig } from './schema.js';
export type {
    LynxConfig,
    ModuleConfig,
    AndroidConfig,
    IosConfig,
    Platform,
    Orientation,
    SplashConfig,
    AdaptiveIconConfig,
} from './schema.js';

export { resolveConfig, modulesForPlatform, resolveAssets } from './parser.js';
export type {
    ResolvedConfig,
    ResolvedModule,
    ResolvedPlatformAssets,
    ResolvedAndroidAssets,
} from './parser.js';
