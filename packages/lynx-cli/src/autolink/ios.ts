import type { ResolvedConfig } from '../config/parser.js';
import type { IosAppDelegateHookMethod, IosUiComponentEntry, ModuleManifest } from '../manifest.js';

/**
 * iOS auto-linker.
 *
 * Given a resolved config and module manifests, generates the native code
 * and build config modifications needed to integrate modules into an
 * iOS project.
 */

/** Dev-client module info discovered during linking. */
export interface IosDevClientInfo {
    /** Swift class name of the init facade (e.g. SigxDevClient). */
    initClass: string;
    /** Relative source directory containing Swift files to copy. */
    sourceDir: string;
    /** npm package name (for resolving absolute path from node_modules). */
    packageName: string;
}

/** Lifecycle publisher info discovered during linking. */
export interface IosLifecyclePublisherInfo {
    /** Swift class name (must accept `init(lynxView: LynxView)`). */
    publisherClass: string;
    /** Relative source directory containing the publisher's Swift files. */
    sourceDir: string;
    /** npm package name. */
    packageName: string;
    /** Manifest module name (used in log messages). */
    moduleName: string;
}

/** Generated output from the iOS auto-linker. */
export interface IosLinkResult {
    /** Podfile entries to add. */
    podfileEntries: string[];
    /** Debug-only Podfile entries. */
    debugPodfileEntries: string[];
    /** Info.plist usage descriptions to add (all build configurations). */
    usageDescriptions: Record<string, string>;
    /**
     * Usage descriptions contributed by `debugOnly` modules — written to the
     * generated `Info.debug.plist` (Debug configuration only) so App Store
     * binaries don't declare permission strings (e.g. camera for the
     * dev-client QR scanner) that no release code uses.
     */
    debugUsageDescriptions: Record<string, string>;
    /** UIBackgroundModes entries to add to Info.plist. */
    backgroundModes: string[];
    /** BGTaskSchedulerPermittedIdentifiers entries to add to Info.plist. */
    bgTaskIdentifiers: string[];
    /** Swift source for module registration. */
    registryCode: string;
    /** Swift source for lifecycle-publisher attachment. */
    lifecycleCode: string;
    /** Swift source for AppDelegate hook dispatcher. */
    appDelegateHooksCode: string;
    /** Swift source for the LynxConfig component registry. */
    componentRegistryCode: string;
    /** Swift source for the startup bundle resolver delegate. */
    bundleResolverCode: string;
    /** Class name of the module-provided startup bundle resolver, if any. */
    bundleResolverClass?: string;
    /** Tag names of UI components that were registered. */
    linkedComponents: string[];
    /** Modules that were linked. */
    linkedModules: string[];
    /** Lifecycle publishers that were linked. */
    linkedLifecyclePublishers: string[];
    /** Discovered lifecycle publishers (for source copying). */
    lifecyclePublishers: IosLifecyclePublisherInfo[];
    /** Module names that registered an AppDelegate hook. */
    linkedAppDelegateHooks: string[];
    /** Dev-client module info, if found. */
    devClient?: IosDevClientInfo;
}

type IosAppDelegateHookInvocation = { hookClass: string; manifestName: string };
type IosAppDelegateHookGroups = Record<IosAppDelegateHookMethod, IosAppDelegateHookInvocation[]>;

/**
 * Generate iOS auto-link output for a set of modules.
 */
export function linkIos(
    config: ResolvedConfig,
    manifests: ModuleManifest[]
): IosLinkResult {
    const iosManifests = manifests.filter(
        (m) => m.platforms.includes('ios') && m.ios
    );

    const linkedModules: string[] = [];
    const linkedLifecyclePublishers: string[] = [];
    const lifecyclePublishers: IosLifecyclePublisherInfo[] = [];
    const linkedAppDelegateHooks: string[] = [];
    const appDelegateHookGroups: IosAppDelegateHookGroups = {
        didFinishLaunching: [],
        openURL: [],
        continueUserActivity: [],
        didRegisterForRemoteNotificationsWithDeviceToken: [],
        didFailToRegisterForRemoteNotificationsWithError: [],
    };
    const podfileEntries: string[] = [];
    const debugPodfileEntries: string[] = [];
    const usageDescriptions: Record<string, string> = {
        ...(config.ios.usageDescriptions ?? {}),
    };
    const debugUsageDescriptions: Record<string, string> = {};
    const backgroundModes = new Set<string>();
    const bgTaskIdentifiers = new Set<string>();
    for (const id of config.ios.bgTaskIdentifiers ?? []) bgTaskIdentifiers.add(id);
    const uiComponents: IosUiComponentEntry[] = [];
    const seenUiComponentNames = new Set<string>();
    const registrations: string[] = [];
    const debugRegistrations: string[] = [];
    const debugModuleNames: string[] = [];
    const lifecycleAttachments: string[] = [];
    let devClient: IosDevClientInfo | undefined;
    let bundleResolverClass: string | undefined;
    let bundleResolverPackage: string | undefined;

    for (const manifest of iosManifests) {
        const ios = manifest.ios!;

        // Each manifest can contribute up to three things — a registered
        // LynxModule (moduleClass), a per-LynxView lifecycle publisher
        // (publisherClass), and a dev-client init facade (initClass). All
        // three are independent: a single package can ship both a module and
        // a publisher (e.g. @sigx/lynx-linking — bridge methods for openURL
        // plus a per-LynxView publisher that forwards incoming URLs via
        // sendGlobalEvent). `linkedModules` tracks the bridge-registered
        // names (used by dev-menu introspection); publishers are tracked
        // separately on `linkedLifecyclePublishers`. Pods + usage
        // descriptions are emitted once per manifest regardless.

        // Lifecycle publisher — instantiated after each LynxView is built.
        if (ios.publisherClass && ios.sourceDir) {
            linkedLifecyclePublishers.push(manifest.name);
            lifecyclePublishers.push({
                publisherClass: ios.publisherClass,
                sourceDir: ios.sourceDir,
                packageName: manifest.package,
                moduleName: manifest.name,
            });
            lifecycleAttachments.push(
                `        ${ios.publisherClass}(lynxView: lynxView)`
            );
        }

        // Dev-client init facade — debug-only by definition, so its name is
        // listed under #if DEBUG in the registry regardless of the manifest's
        // explicit debugOnly flag.
        if (manifest.type === 'dev-client' && ios.initClass && ios.sourceDir) {
            devClient = {
                initClass: ios.initClass,
                sourceDir: ios.sourceDir,
                packageName: manifest.package,
            };
            if (!linkedModules.includes(manifest.name)) {
                linkedModules.push(manifest.name);
            }
            if (!debugModuleNames.includes(manifest.name)) {
                debugModuleNames.push(manifest.name);
            }
        }

        // Standard LynxModule. debugOnly modules (the dev client) register
        // inside `#if DEBUG` — their sources are excluded from the Release
        // configuration, so an unconditional `.self` reference would fail
        // `xcodebuild -configuration Release` with "cannot find in scope".
        if (ios.moduleClass) {
            if (!linkedModules.includes(manifest.name)) {
                linkedModules.push(manifest.name);
            }
            if (ios.debugOnly && !debugModuleNames.includes(manifest.name)) {
                debugModuleNames.push(manifest.name);
            }
            (ios.debugOnly ? debugRegistrations : registrations).push(
                `        register(on: config, moduleClass: ${ios.moduleClass}.self,\n` +
                `            description: "${manifest.description}",\n` +
                `            methods: ${JSON.stringify(ios.methods ?? [])})`
            );
        }

        // Startup bundle resolver — at most one per platform (see the
        // Android autolinker for rationale).
        if (ios.bundleResolverClass) {
            if (bundleResolverClass) {
                throw new Error(
                    `Two packages declare ios.bundleResolverClass: ` +
                    `${bundleResolverPackage} and ${manifest.package}. ` +
                    `Only one startup bundle resolver can be linked — remove one of the packages.`
                );
            }
            bundleResolverClass = ios.bundleResolverClass;
            bundleResolverPackage = manifest.package;
        }

        // AppDelegate hook — Swift class declaring zero or more AppDelegate
        // methods (didFinishLaunching, openURL, continueUserActivity). The
        // generator emits dispatcher calls only for declared methods.
        if (ios.appDelegateHook) {
            const hookClass = ios.appDelegateHook.class;
            const methods = ios.appDelegateHook.methods ?? [];
            if (methods.length > 0) {
                linkedAppDelegateHooks.push(manifest.name);
                for (const method of methods) {
                    appDelegateHookGroups[method].push({
                        hookClass,
                        manifestName: manifest.name,
                    });
                }
            }
        }

        // Pods + usage descriptions apply to the manifest as a whole.
        if (ios.pods) {
            const entries = Object.entries(ios.pods);
            if (ios.debugOnly) {
                for (const [name, version] of entries) {
                    debugPodfileEntries.push(`  pod '${name}', '${version}', :configurations => ['Debug']`);
                }
            } else {
                for (const [name, version] of entries) {
                    podfileEntries.push(`  pod '${name}', '${version}'`);
                }
            }
        }
        if (ios.usageDescriptions) {
            // debugOnly modules' usage descriptions go to Info.debug.plist
            // only, so release binaries don't carry permission strings for
            // features that ship exclusively in debug builds.
            Object.assign(ios.debugOnly ? debugUsageDescriptions : usageDescriptions, ios.usageDescriptions);
        }
        if (ios.backgroundModes) {
            for (const mode of ios.backgroundModes) backgroundModes.add(mode);
        }
        if (ios.bgTaskIdentifiers) {
            for (const id of ios.bgTaskIdentifiers) bgTaskIdentifiers.add(id);
        }
        if (ios.uiComponents) {
            for (const entry of ios.uiComponents) {
                // De-dup on tag name — two packages declaring the same tag is
                // a misconfiguration; first declaration wins (matches how
                // moduleClass de-dupes by manifest.name).
                if (seenUiComponentNames.has(entry.name)) continue;
                seenUiComponentNames.add(entry.name);
                uiComponents.push(entry);
            }
        }
    }

    // Add user-specified pods
    if (config.ios.pods) {
        for (const [name, version] of Object.entries(config.ios.pods)) {
            podfileEntries.push(`  pod '${name}', '${version}'`);
        }
    }

    const registryCode = generateRegistrySwift(
        registrations,
        debugRegistrations,
        linkedModules.filter((n) => !debugModuleNames.includes(n)),
        debugModuleNames,
    );
    const lifecycleCode = generateLifecycleSwift(lifecycleAttachments);
    const appDelegateHooksCode = generateAppDelegateHooksSwift(appDelegateHookGroups);
    const componentRegistryCode = generateComponentRegistrySwift(uiComponents);
    const bundleResolverCode = generateBundleResolverSwift(bundleResolverClass);
    const linkedComponents = uiComponents.map((c) => c.name);

    return {
        podfileEntries: [...new Set(podfileEntries)],
        debugPodfileEntries: [...new Set(debugPodfileEntries)],
        usageDescriptions,
        // Drop debug entries already declared for all configurations.
        debugUsageDescriptions: Object.fromEntries(
            Object.entries(debugUsageDescriptions).filter(([k]) => !(k in usageDescriptions)),
        ),
        backgroundModes: [...backgroundModes],
        bgTaskIdentifiers: [...bgTaskIdentifiers],
        registryCode,
        lifecycleCode,
        appDelegateHooksCode,
        componentRegistryCode,
        bundleResolverCode,
        bundleResolverClass,
        linkedComponents,
        linkedModules,
        linkedLifecyclePublishers,
        lifecyclePublishers,
        linkedAppDelegateHooks,
        devClient,
    };
}

/**
 * Generate the AppDelegate hook dispatcher.
 *
 * The app's AppDelegate calls into this enum at every supported
 * UIApplicationDelegate method. Each method body invokes every registered
 * package's hook. `openURL` short-circuits on the first hook returning true
 * (the URL was handled).
 */
function generateAppDelegateHooksSwift(groups: IosAppDelegateHookGroups): string {
    const renderVoidMethod = (
        signature: string,
        invocations: IosAppDelegateHookInvocation[],
        callExpr: (hookClass: string) => string,
    ): string => {
        if (invocations.length === 0) {
            return `    static func ${signature} {}`;
        }
        const body = invocations
            .map((inv) => `        ${callExpr(inv.hookClass)}`)
            .join('\n');
        return `    static func ${signature} {\n${body}\n    }`;
    };

    const didFinishLaunching = renderVoidMethod(
        'didFinishLaunching(_ application: UIApplication, launchOptions: [UIApplication.LaunchOptionsKey: Any]?)',
        groups.didFinishLaunching,
        (cls) =>
            `${cls}.didFinishLaunching(application, launchOptions: launchOptions)`,
    );

    const openURLBody =
        groups.openURL.length === 0
            ? `    static func openURL(_ url: URL, options: [UIApplication.OpenURLOptionsKey: Any]) -> Bool { return false }`
            : `    static func openURL(_ url: URL, options: [UIApplication.OpenURLOptionsKey: Any]) -> Bool {\n` +
              groups.openURL
                  .map(
                      (inv) =>
                          `        if ${inv.hookClass}.openURL(url, options: options) { return true }`,
                  )
                  .join('\n') +
              `\n        return false\n    }`;

    const continueUserActivity = renderVoidMethod(
        'continueUserActivity(_ userActivity: NSUserActivity)',
        groups.continueUserActivity,
        (cls) => `${cls}.continueUserActivity(userActivity)`,
    );

    const didRegisterForRemoteNotifications = renderVoidMethod(
        'didRegisterForRemoteNotificationsWithDeviceToken(_ application: UIApplication, deviceToken: Data)',
        groups.didRegisterForRemoteNotificationsWithDeviceToken,
        (cls) => `${cls}.didRegisterForRemoteNotificationsWithDeviceToken(application, deviceToken: deviceToken)`,
    );

    const didFailToRegisterForRemoteNotifications = renderVoidMethod(
        'didFailToRegisterForRemoteNotificationsWithError(_ application: UIApplication, error: Error)',
        groups.didFailToRegisterForRemoteNotificationsWithError,
        (cls) => `${cls}.didFailToRegisterForRemoteNotificationsWithError(application, error: error)`,
    );

    return `import Foundation
import UIKit

/// Auto-generated AppDelegate hook dispatcher.
/// Generated by \`sigx prebuild\` — do not edit manually.
///
/// Each registered \`@sigx/lynx-*\` package can ship a Swift class with
/// static methods implementing some subset of UIApplicationDelegate
/// methods. The dispatcher fans the host's calls out to every registered
/// hook in declaration order. \`openURL\` short-circuits on the first hook
/// that returns true (URL handled).
enum GeneratedAppDelegateHooks {

${didFinishLaunching}

${openURLBody}

${continueUserActivity}

${didRegisterForRemoteNotifications}

${didFailToRegisterForRemoteNotifications}
}
`;
}

function generateRegistrySwift(
    registrations: string[],
    debugRegistrations: string[],
    moduleNames: string[],
    debugModuleNames: string[],
): string {
    const quoteNames = (names: string[]) => names.map((n) => `"${n}"`).join(', ');
    // debugOnly modules (the dev client) only exist in Debug builds — their
    // sources are excluded from the Release configuration — so both their
    // registration calls and their introspection names compile behind
    // `#if DEBUG`.
    const namesDecl = debugModuleNames.length > 0
        ? `    /** Names of registered modules — used by dev-menu introspection. */
    #if DEBUG
    static let registeredModules: [String] = [${quoteNames([...moduleNames, ...debugModuleNames])}]
    #else
    static let registeredModules: [String] = [${quoteNames(moduleNames)}]
    #endif`
        : `    /** Names of registered modules — used by dev-menu introspection. */
    static let registeredModules: [String] = [${quoteNames(moduleNames)}]`;
    const debugBlock = debugRegistrations.length > 0
        ? `\n        #if DEBUG\n${debugRegistrations.join('\n\n')}\n        #endif\n`
        : '';
    return `import Foundation
import Lynx

/**
 * Auto-generated module registry.
 * Generated by \`sigx prebuild\` — do not edit manually.
 *
 * Caller passes in the LynxConfig they already constructed (lets this
 * file work in any host: example apps that hold config on
 * LynxSetupService, the Go host that holds it on LynxService, etc.).
 */
class GeneratedModuleRegistry {

${namesDecl}

    private static var registeredCount = 0

    static func registerAll(on config: LynxConfig) {
        registeredCount = 0
        print("[GeneratedModuleRegistry] Registering auto-linked modules...")

${registrations.join('\n\n')}
${debugBlock}
        print("[GeneratedModuleRegistry] Auto-linked \\(registeredCount) modules")
    }

    private static func register(
        on config: LynxConfig,
        moduleClass: (NSObject & LynxModule).Type,
        description: String,
        methods: [String]
    ) {
        config.register(moduleClass)
        registeredCount += 1
        print("  ✓ \\(moduleClass.name)")
    }
}
`;
}

/**
 * Generate the Swift registry that maps JSX tag names to `LynxUI` subclasses.
 * Called from `LynxSetupService.initialize` BEFORE `LynxEnv.prepareConfig` so
 * the shared config already carries every registered component when the first
 * `LynxView` is built.
 *
 * `registerUI(_:withName:)` is on the public `LynxConfig` API
 * (`Pods/Lynx/.../LynxConfig.h`). Registration is per-config, not per-view,
 * so doing it once on the shared `LynxSetupService.shared.config` covers
 * every `LynxView` the app subsequently creates.
 */
function generateComponentRegistrySwift(components: IosUiComponentEntry[]): string {
    const lines = components.map((c) =>
        `        config.registerUI(${c.uiClass}.self, withName: "${c.name}")`
    );
    const body = lines.length > 0 ? lines.join('\n') : '        // (no auto-linked UI components)';
    return `import Foundation
import Lynx

/**
 * Auto-generated UI component registry.
 * Generated by \`sigx prebuild\` — do not edit manually.
 *
 * Maps JSX tag names to \`LynxUI\` subclasses contributed by
 * \`@sigx/lynx-*\` packages declaring \`ios.uiComponents\` in their
 * \`signalx-module.json\`. Called from \`LynxSetupService.initialize\`
 * before \`prepareConfig\` so the shared config snapshot carries the
 * registrations.
 */
class GeneratedComponentRegistry {

    static let registeredComponents: [String] = [${
        components.length > 0
            ? components.map((c) => `"${c.name}"`).join(', ')
            : ''
    }]

    static func registerAll(on config: LynxConfig) {
        print("[GeneratedComponentRegistry] Registering auto-linked UI components...")
${body}
        print("[GeneratedComponentRegistry] Auto-linked \\(registeredComponents.count) UI component(s)")
    }
}
`;
}

/**
 * Generate the startup bundle resolver delegate. The host calls
 * `GeneratedBundleResolver.resolveStartupBundlePath()` once at startup,
 * before falling back to the baked `main.lynx.bundle` resource. When no
 * linked module declares `ios.bundleResolverClass` the body is
 * `return nil`, so apps without an OTA package compile and behave exactly
 * as before.
 */
function generateBundleResolverSwift(resolverClass?: string): string {
    const body = resolverClass
        ? `        return ${resolverClass}.resolveStartupBundlePath()`
        : `        return nil`;
    return `import Foundation

/**
 * Auto-generated startup bundle resolver.
 * Generated by \`sigx prebuild\` — do not edit manually.
 *
 * Consulted by the host before loading the baked \`main.lynx.bundle\`
 * resource. A non-nil return is an absolute filesystem path to a bundle the
 * host should load instead (e.g. an OTA update staged by
 * \`@sigx/lynx-updates\`).
 */
enum GeneratedBundleResolver {

    static func resolveStartupBundlePath() -> String? {
${body}
    }
}
`;
}

/**
 * Generate the per-LynxView lifecycle-publisher entry point. Hosts (the Go
 * app's LynxContainerView, generated apps' ContentView) call
 * `GeneratedLifecyclePublishers.attachAll(to: lynxView)` after building each
 * LynxView and retain the returned array so each publisher's observers
 * outlive the call. Returning `[Any]` keeps the publishers' types opaque so
 * adding a new publisher doesn't churn the host signature.
 */
function generateLifecycleSwift(attachments: string[]): string {
    const body = attachments.length > 0
        ? `        return [\n${attachments.join(',\n')}\n        ]`
        : `        return []`;
    return `import Foundation
import Lynx

/**
 * Auto-generated lifecycle-publisher attachment point.
 * Generated by \`sigx prebuild\` — do not edit manually.
 *
 * Hosts call \`attachAll(to: lynxView)\` after building each LynxView and
 * retain the returned array so each publisher's observer subscriptions
 * outlive the call. Each publisher exposes \`init(lynxView:)\`; observer
 * registration happens in the initializer.
 */
class GeneratedLifecyclePublishers {

    static func attachAll(to lynxView: LynxView) -> [Any] {
${body}
    }
}
`;
}
