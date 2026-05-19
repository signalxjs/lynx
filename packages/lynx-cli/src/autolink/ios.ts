import type { ResolvedConfig } from '../config/parser';
import type { IosAppDelegateHookMethod, ModuleManifest } from '../manifest';

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
    /** Info.plist usage descriptions to add. */
    usageDescriptions: Record<string, string>;
    /** Swift source for module registration. */
    registryCode: string;
    /** Swift source for lifecycle-publisher attachment. */
    lifecycleCode: string;
    /** Swift source for AppDelegate hook dispatcher. */
    appDelegateHooksCode: string;
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
    };
    const podfileEntries: string[] = [];
    const debugPodfileEntries: string[] = [];
    const usageDescriptions: Record<string, string> = {
        ...(config.ios.usageDescriptions ?? {}),
    };
    const registrations: string[] = [];
    const lifecycleAttachments: string[] = [];
    let devClient: IosDevClientInfo | undefined;

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

        // Dev-client init facade — debug-only.
        if (manifest.type === 'dev-client' && ios.initClass && ios.sourceDir) {
            devClient = {
                initClass: ios.initClass,
                sourceDir: ios.sourceDir,
                packageName: manifest.package,
            };
            if (!linkedModules.includes(manifest.name)) {
                linkedModules.push(manifest.name);
            }
        }

        // Standard LynxModule.
        if (ios.moduleClass) {
            if (!linkedModules.includes(manifest.name)) {
                linkedModules.push(manifest.name);
            }
            registrations.push(
                `        register(on: config, moduleClass: ${ios.moduleClass}.self,\n` +
                `            description: "${manifest.description}",\n` +
                `            methods: ${JSON.stringify(ios.methods ?? [])})`
            );
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
            Object.assign(usageDescriptions, ios.usageDescriptions);
        }
    }

    // Add user-specified pods
    if (config.ios.pods) {
        for (const [name, version] of Object.entries(config.ios.pods)) {
            podfileEntries.push(`  pod '${name}', '${version}'`);
        }
    }

    const registryCode = generateRegistrySwift(registrations, linkedModules);
    const lifecycleCode = generateLifecycleSwift(lifecycleAttachments);
    const appDelegateHooksCode = generateAppDelegateHooksSwift(appDelegateHookGroups);

    return {
        podfileEntries: [...new Set(podfileEntries)],
        debugPodfileEntries: [...new Set(debugPodfileEntries)],
        usageDescriptions,
        registryCode,
        lifecycleCode,
        appDelegateHooksCode,
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
}
`;
}

function generateRegistrySwift(registrations: string[], moduleNames: string[]): string {
    const namesArray = moduleNames.length > 0
        ? moduleNames.map((n) => `"${n}"`).join(', ')
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

    /** Names of registered modules — used by dev-menu introspection. */
    static let registeredModules: [String] = [${namesArray}]

    static func registerAll(on config: LynxConfig) {
        print("[GeneratedModuleRegistry] Registering auto-linked modules...")

${registrations.join('\n\n')}

        print("[GeneratedModuleRegistry] Auto-linked \\(${registrations.length}) modules")
    }

    private static func register(
        on config: LynxConfig,
        moduleClass: (NSObject & LynxModule).Type,
        description: String,
        methods: [String]
    ) {
        config.register(moduleClass)
        print("  ✓ \\(moduleClass.name)")
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
