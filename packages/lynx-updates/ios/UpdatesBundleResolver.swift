import Foundation

/// Startup bundle resolver — the host's `GeneratedBundleResolver` delegates
/// here (declared as `ios.bundleResolverClass` in signalx-module.json).
///
/// Runs synchronously in `ContentView.init` BEFORE any LynxView is built,
/// and mutates rollback state (the launch-attempt counter), so it must run
/// exactly once per process launch — which the generated host guarantees by
/// resolving into a stored `let`.
enum UpdatesBundleResolver {

    static func resolveStartupBundlePath() -> String? {
        UpdateStore.shared.resolveStartupBundlePath()
    }
}
