import Foundation
import Lynx
import ObjectiveC.runtime

/// Facade API for sigx-lynx iOS dev client.
///
/// Templates call these methods in order:
/// 1. `SigxDevClient.registerServices()` — BEFORE LynxSetupService.initialize(), enables debug preset
/// 2. `SigxDevClient.enableDevMode()` — AFTER LynxSetupService.initialize(), enables devtool/logbox
/// 3. `SigxDevClient.configureForDev(builder:)` — in LynxView setup for dev mode
class SigxDevClient {

    /// Enable lynxDebug on LynxEnv so that prepareConfig can initialize devtool env.
    /// Call BEFORE LynxSetupService.shared.initialize() in `#if DEBUG`.
    static func registerServices() {
        let env = LynxEnv.sharedInstance()
        env.lynxDebugEnabled = true

        // Mirror Android's setLogBoxPresetValue(true): LynxEnv.logBoxEnabled
        // ANDs in `[LynxService(LynxServiceDevToolProtocol) logBoxPresetValue]`,
        // which is initialised to NO. Without this flip, errors give a silent
        // white screen on iOS instead of the native Lynx logbox overlay.
        // We dispatch through the Obj-C runtime (rather than the typed Swift
        // import) because the Lynx pods don't ship a Swift-friendly facade
        // for `+[LynxServices getInstanceWithProtocol:]`.
        setDevToolPresetValue(true, forKey: "logBoxPresetValue")

        print("[SigxDevClient] Set lynxDebugEnabled and logBoxPresetValue (before prepareConfig)")
    }

    /// Flip a BOOL `@property` on the registered `LynxServiceDevToolProtocol`
    /// service instance via Obj-C runtime + KVC.
    private static func setDevToolPresetValue(_ value: Bool, forKey key: String) {
        guard let servicesCls = NSClassFromString("LynxServices") else { return }
        guard let proto = NSProtocolFromString("LynxServiceDevToolProtocol") else { return }
        let sel = NSSelectorFromString("getInstanceWithProtocol:")
        guard let method = class_getClassMethod(servicesCls, sel) else { return }

        typealias GetInstanceFn = @convention(c) (AnyClass, Selector, Protocol) -> NSObject?
        let fn = unsafeBitCast(method_getImplementation(method), to: GetInstanceFn.self)
        if let svc = fn(servicesCls, sel, proto) {
            svc.setValue(value, forKey: key)
        }
    }

    /// Enable devtool and logbox flags on LynxEnv.
    /// MUST be called AFTER LynxSetupService.shared.initialize() (i.e. after prepareConfig).
    static func enableDevMode() {
        let env = LynxEnv.sharedInstance()
        env.devtoolEnabled = true
        env.logBoxEnabled = true
        // Without these the Lynx DevTools desktop app can attach but the JS
        // inspector bridge never comes up — the device never appears in the
        // DevTools device list. Mirrors the Android side's
        // `LynxEnv.setEnableDevtoolDebug(true)` +
        // `LynxEnv.setEnableJSDebug(true)` calls.
        env.enableDevtoolDebug = true
        env.enableJSDebug = true
        print("[SigxDevClient] Enabled devtool, logbox, devtoolDebug, jsDebug on LynxEnv (after init)")
    }

    /// Configure a LynxView builder for dev mode (HTTP resource fetching + HMR).
    /// Call when launching with a dev server URL.
    static func configureForDev(builder: LynxViewBuilder) {
        builder.templateResourceFetcher = DevTemplateResourceFetcher()
        builder.enableGenericResourceFetcher = .true
        builder.genericResourceFetcher = DevGenericResourceFetcher()
        print("[SigxDevClient] Configured LynxViewBuilder for dev mode (resource fetchers)")
    }

    private static let lastConnectedUrlKey = "sigx_dev_client.last_connected_url"
    private static let recentUrlsKey = "sigx_dev_client.recent_urls"
    private static let recentUrlsMax = 20

    /// Most recently used dev-server URL, persisted across launches so the app
    /// can reconnect after a warm restart (icon-tap with no `--sigx_dev_url`
    /// launch argument). Mirror of Android's `DevSettings.lastConnectedUrl`.
    static var lastConnectedUrl: String? {
        get {
            let value = UserDefaults.standard.string(forKey: lastConnectedUrlKey)
            return (value?.isEmpty ?? true) ? nil : value
        }
        set {
            UserDefaults.standard.set(newValue, forKey: lastConnectedUrlKey)
        }
    }

    /// History of dev-server URLs the user has connected to from
    /// `DevHomeScreen`, most-recent first. Capped at 20 entries.
    public static var recentUrls: [String] {
        UserDefaults.standard.stringArray(forKey: recentUrlsKey) ?? []
    }

    /// Insert `url` at the front of the recent-URLs list, dedup, and trim to
    /// the cap. Also updates `lastConnectedUrl` so warm restarts reconnect.
    public static func addRecentUrl(_ url: String) {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        var urls = recentUrls.filter { $0 != trimmed }
        urls.insert(trimmed, at: 0)
        UserDefaults.standard.set(Array(urls.prefix(recentUrlsMax)), forKey: recentUrlsKey)
        lastConnectedUrl = trimmed
    }

    public static func removeRecentUrl(_ url: String) {
        let urls = recentUrls.filter { $0 != url }
        UserDefaults.standard.set(urls, forKey: recentUrlsKey)
    }

    public static func clearRecentUrls() {
        UserDefaults.standard.removeObject(forKey: recentUrlsKey)
    }
}
