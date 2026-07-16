export { defineLynxConfig } from './schema.js';
export type {
    LynxConfig,
    VariantConfig,
    ModuleConfig,
    AndroidConfig,
    AndroidFeatureConfig,
    IosConfig,
    IosIconConfig,
    Platform,
    Orientation,
    SplashConfig,
    SplashDarkConfig,
    SplashResizeMode,
    AdaptiveIconConfig,
    IconSetConfig,
    IconMode,
    IconStyle,
    LoggingConfig,
    LogLevelName,
    PlistValue,
} from './schema.js';

export { resolveConfig, modulesForPlatform, resolveAssets } from './parser.js';
export type {
    ResolvedConfig,
    ResolvedModule,
    ResolvedIconSet,
    ResolvedPlatformAssets,
    ResolvedIosAssets,
    ResolvedAndroidAssets,
} from './parser.js';
