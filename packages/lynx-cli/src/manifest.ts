/**
 * Module manifest schema — `signalx-module.json`.
 *
 * Every @sigx/lynx-* native module package includes this manifest file
 * that tells the auto-linker how to integrate the module into native projects.
 * Community modules follow the same spec.
 */

export interface ModuleManifest {
    /** Module bridge name as registered in NativeModules (e.g. 'Camera'). */
    name: string;
    /** npm package name. */
    package: string;
    /** Human-readable description. */
    description: string;
    /** Module type: 'module' for standard LynxModule, 'dev-client' for dev tooling. */
    type?: 'module' | 'dev-client';
    /** Platforms this module supports. */
    platforms: ('android' | 'ios')[];
    /** Android-specific auto-link configuration. */
    android?: AndroidManifest;
    /** iOS-specific auto-link configuration. */
    ios?: IosManifest;
}

export interface AndroidManifest {
    /** Fully-qualified Kotlin/Java class name of the LynxModule implementation. */
    moduleClass?: string;
    /**
     * Fully-qualified class name of a lifecycle publisher (used when
     * `kind === 'lifecycle'`). The class is expected to expose a public
     * single-arg constructor `(lynxView: LynxView)` and an `attach()` method;
     * the generated `GeneratedLifecyclePublishers.attachAll(lynxView)` calls
     * `<class>(lynxView).attach()` for each registered publisher.
     */
    publisherClass?: string;
    /**
     * Activity-lifecycle hook — a Kotlin `object` (singleton) declaring zero
     * or more of the supported lifecycle methods. The autolinker generates
     * `GeneratedActivityHooks.kt` that calls every registered hook's methods
     * from `MainActivity`. This is how packages plug into `onCreate` /
     * `onResume` / `onPause` / `onNewIntent` / `onBackPressed` /
     * `onRequestPermissionsResult` without the app having to edit
     * `MainActivity.kt`.
     */
    activityHook?: ActivityHookManifest;
    /** Fully-qualified class name of the init facade (for dev-client type modules). */
    initClass?: string;
    /** Relative path to Kotlin/Java source directory (for source-based linking). */
    sourceDir?: string;
    /** If true, this module is only linked in debug builds (debugImplementation). */
    debugOnly?: boolean;
    /** Gradle dependencies to inject into app/build.gradle.kts. */
    dependencies?: string[];
    /** AndroidManifest.xml permissions required. */
    permissions?: string[];
    /** Min SDK required by this module. */
    minSdk?: number;
}

/** Recognised Android Activity lifecycle methods a hook can implement. */
export type AndroidActivityHookMethod =
    | 'onCreate'
    | 'onResume'
    | 'onPause'
    | 'onNewIntent'
    | 'onBackPressed'
    | 'onRequestPermissionsResult';

export interface ActivityHookManifest {
    /** Fully-qualified Kotlin object (singleton) class — e.g. `com.sigx.linking.LinkingActivityHook`. */
    class: string;
    /**
     * The lifecycle methods this hook implements. The generator only emits
     * dispatch lines for declared methods, so adding a new method is
     * non-breaking for hooks that don't declare it. Method signatures are
     * fixed by convention — see `LinkingActivityHook` for examples.
     */
    methods: AndroidActivityHookMethod[];
}

export interface IosManifest {
    /** Swift/ObjC class name of the native module. */
    moduleClass?: string;
    /**
     * Swift/ObjC class name of a lifecycle publisher (used when
     * `kind === 'lifecycle'`). The class is expected to expose an
     * `init(lynxView: LynxView)`. The generated
     * `GeneratedLifecyclePublishers.attachAll(to:)` instantiates one per
     * LynxView; the host retains the returned array on a coordinator so the
     * publishers' observer subscriptions outlive the call.
     */
    publisherClass?: string;
    /**
     * AppDelegate-lifecycle hook — Swift class (or `enum` with static
     * methods) declaring zero or more of the supported AppDelegate methods.
     * The autolinker generates `GeneratedAppDelegateHooks.swift` that calls
     * every registered hook's methods from the app's `AppDelegate`.
     */
    appDelegateHook?: IosAppDelegateHookManifest;
    /** Fully-qualified class name of the init facade (for dev-client type modules). */
    initClass?: string;
    /** Relative path to Swift source directory (for source-based linking). */
    sourceDir?: string;
    /** If true, this module is only linked in debug builds. */
    debugOnly?: boolean;
    /** Method names exported by this module. */
    methods?: string[];
    /** CocoaPods dependencies (name → version). */
    pods?: Record<string, string>;
    /** Info.plist usage description keys required. */
    usageDescriptions?: Record<string, string>;
    /** Minimum iOS deployment target required. */
    deploymentTarget?: string;
}

/** Recognised iOS AppDelegate methods a hook can implement. */
export type IosAppDelegateHookMethod =
    | 'didFinishLaunching'
    | 'openURL'
    | 'continueUserActivity';

export interface IosAppDelegateHookManifest {
    /** Swift class/enum name — e.g. `LinkingAppDelegateHook`. */
    class: string;
    /** AppDelegate methods this hook implements. */
    methods: IosAppDelegateHookMethod[];
}

/**
 * Validate a module manifest object. Returns errors if invalid.
 */
export function validateManifest(manifest: unknown): string[] {
    const errors: string[] = [];
    if (!manifest || typeof manifest !== 'object') {
        return ['Manifest must be a non-null object'];
    }

    const m = manifest as Record<string, unknown>;

    if (!m.name || typeof m.name !== 'string') {
        errors.push('Missing or invalid "name" field (string required)');
    }
    if (!m.package || typeof m.package !== 'string') {
        errors.push('Missing or invalid "package" field (string required)');
    }
    if (!Array.isArray(m.platforms) || m.platforms.length === 0) {
        errors.push('Missing or empty "platforms" array');
    }
    if (m.type && m.type !== 'module' && m.type !== 'dev-client') {
        errors.push('"type" must be "module" or "dev-client"');
    }
    if ('kind' in m) {
        errors.push('"kind" is no longer supported — set ios.moduleClass and/or ios.publisherClass (and the Android equivalents) directly');
    }

    // Each declared platform must have a config block. Within the block,
    // any of the recognised contributions is fine: a registered class
    // (moduleClass / publisherClass / initClass) OR a sourceDir-only
    // package that just contributes shared native code consumed by other
    // packages (e.g. `@sigx/lynx-permissions`'s PermissionHelper /
    // MediaCapture). Permissions/pods/dependencies on their own are also
    // permitted — that's how pure-config manifests work.
    const platforms = (m.platforms as string[]) ?? [];
    for (const platform of ['ios', 'android'] as const) {
        if (!platforms.includes(platform)) continue;
        const block = m[platform];
        if (!block || typeof block !== 'object') {
            errors.push(`"${platform}" config is required when platforms includes "${platform}"`);
        }
    }

    return errors;
}
