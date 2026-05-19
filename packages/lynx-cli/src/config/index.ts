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
    IconSetConfig,
    IconMode,
    IconStyle,
} from './schema';

export { resolveConfig, modulesForPlatform, resolveAssets } from './parser';
export type {
    ResolvedConfig,
    ResolvedModule,
    ResolvedIconSet,
    ResolvedPlatformAssets,
    ResolvedAndroidAssets,
} from './parser';
