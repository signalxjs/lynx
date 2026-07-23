import Foundation
import Lynx

/// Singleton service for managing the Lynx SDK lifecycle.
class LynxSetupService {
    static let shared = LynxSetupService()

    private(set) var config: LynxConfig?
    private var isInitialized = false

    private init() {}

    func initialize(provider: LynxTemplateProvider? = nil) {
        guard !isInitialized else { return }

        // OS font-scale policy from signalx.config.ts (`fontScale: {…}`) —
        // consumed by the LynxView builder seed and FontScalePublisher (#766).
        SigxFontScale.policy = SigxFontScalePolicy(
            follow: {{fontScaleFollow}},
            min: {{fontScaleMin}},
            max: {{fontScaleMax}}
        )

        config = LynxConfig(provider: provider)

        let env = LynxEnv.sharedInstance()
        if let config = config {
            // Built-in Lynx list elements (`<list>` / `<list-item>` /
            // `<list-container>`). Register them explicitly: under static
            // linking (`use_frameworks! :linkage => :static`) Lynx's internal
            // lazy/`+sharedInstance` registration of these tags is unreliable —
            // the registration object files can be dead-stripped, so `<list>`
            // throws `can't createUI for tag 'list'` at runtime (issue #120).
            // These classes are public via the Lynx umbrella header.
            LynxComponentRegistry.registerUI(LynxUICollection.self, withName: "list")
            LynxComponentRegistry.registerUI(LynxUIListContainer.self, withName: "list-container")
            LynxComponentRegistry.registerUI(LynxUIListItem.self, withName: "list-item")

            // Register auto-linked UI components via `LynxConfig.registerUI`
            // BEFORE prepareConfig — `LynxEnv.prepareConfig` snapshots the
            // config, so any registerUI call after this point would be
            // invisible to subsequently-created LynxViews. (The equivalent
            // surface on Android is `LynxViewBuilder.addBehavior`, wired
            // separately in MainActivity.)
            GeneratedComponentRegistry.registerAll(on: config)
            env.prepareConfig(config)
        }

        isInitialized = true
        print("[{{appName}}] Lynx Engine initialized")
    }
}
