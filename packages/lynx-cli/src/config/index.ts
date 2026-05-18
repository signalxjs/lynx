export { defineLynxConfig } from './schema';
export type {
    LynxConfig,
    ModuleConfig,
    AndroidConfig,
    IosConfig,
    Platform,
    Orientation,
    SplashConfig,
    AdaptiveIconConfig,
} from './schema';

export { resolveConfig, modulesForPlatform, resolveAssets } from './parser';
export type {
    ResolvedConfig,
    ResolvedModule,
    ResolvedPlatformAssets,
    ResolvedAndroidAssets,
} from './parser';
