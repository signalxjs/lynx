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

        config = LynxConfig(provider: provider)

        let env = LynxEnv.sharedInstance()
        if let config = config {
            env.prepareConfig(config)
        }

        isInitialized = true
        print("[{{appName}}] Lynx Engine initialized")
    }
}
