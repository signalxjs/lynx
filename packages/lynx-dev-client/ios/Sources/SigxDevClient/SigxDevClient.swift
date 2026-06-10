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

        // The native Lynx LogBox is OFF by default: our `DevErrorOverlay`
        // (driven by `didReceiveError`) is the sole error UI, so enabling the
        // LogBox too would double up (a bottom toast under our full-screen
        // overlay). The overlay also covers the silent-white-screen case the
        // LogBox used to guard. The dev-menu "LogBox" toggle flips this back on
        // via `setLogBoxEnabled(true)`. (`logBoxPresetValue` initialises to NO;
        // we dispatch through the Obj-C runtime because the Lynx pods ship no
        // Swift facade for `+[LynxServices getInstanceWithProtocol:]`.)
        setDevToolPresetValue(false, forKey: "logBoxPresetValue")

        print("[SigxDevClient] Set lynxDebugEnabled (LogBox off by default — overlay handles errors)")
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

    // ── Remote reload bridge ───────────────────────────────────────────────
    //
    // Posted by `DevClientModule.reload()` when the dev server pushes
    // `{ type: 'reload' }` on the log WebSocket (CLI `r` key). The template's
    // `ContentView` observes this notification and calls
    // `devController.reload()` so the LynxView reloads in-place without a
    // native relaunch. We use NotificationCenter rather than a static
    // registration slot because SwiftUI views can subscribe via `.onReceive`
    // without us needing to track lifetimes ourselves.

    /// Notification name posted on the main queue when a remote reload arrives.
    public static let reloadNotification = Notification.Name("com.sigx.devclient.reload")

    /// Hop to the main queue and post `reloadNotification`. Safe to call from
    /// any thread — Lynx native modules can be invoked off the main queue.
    public static func postRemoteReload() {
        if Thread.isMainThread {
            NotificationCenter.default.post(name: reloadNotification, object: nil)
        } else {
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: reloadNotification, object: nil)
            }
        }
    }

    // ── Connection-state bridge ────────────────────────────────────────────
    //
    // The JS streamer calls `DevClientModule.setConnectionState(connected)`
    // when its log WebSocket drops/reconnects. We re-broadcast as a main-queue
    // notification whose `userInfo["connected"]` is a Bool; the template's
    // `ContentView` observes it to toggle the "disconnected" banner.

    /// Notification posted (main queue) when the dev-server connection state
    /// changes. `userInfo["connected"]` is a `Bool`.
    public static let connectionStateNotification = Notification.Name("com.sigx.devclient.connectionState")

    /// Last connection state the streamer reported. The notification isn't
    /// sticky and the streamer de-dups repeated `false`s, so a view appearing
    /// AFTER a drop (e.g. server down at boot) must seed its banner from this
    /// rather than wait for an update that already fired.
    public private(set) static var lastConnectionState: Bool = true

    /// Post the current dev-server connection state. Safe from any thread —
    /// `lastConnectionState` is mutated only on the main queue (alongside the
    /// SwiftUI reads in `onAppear`) so there's no data race even when the Lynx
    /// bridge invokes this off-main.
    public static func postConnectionState(_ connected: Bool) {
        let post = {
            lastConnectionState = connected
            NotificationCenter.default.post(
                name: connectionStateNotification,
                object: nil,
                userInfo: ["connected": connected]
            )
        }
        if Thread.isMainThread { post() } else { DispatchQueue.main.async { post() } }
    }

    // ── Dev-menu devtool toggles ───────────────────────────────────────────
    //
    // Mirror Android's best-effort reflection toggles in `DevLynxScreen`'s
    // dev menu. Each flips a flag on `LynxEnv` / the devtool service and is a
    // no-op if the underlying API isn't present, so they degrade gracefully.

    /// Toggle the native Lynx logbox (the red error overlay the engine shows
    /// on a JS/render error). Flips `LynxServiceDevToolProtocol.logBoxPresetValue`,
    /// the same flag `registerServices()` seeds. Returns the new value.
    @discardableResult
    public static func setLogBoxEnabled(_ enabled: Bool) -> Bool {
        setDevToolPresetValue(enabled, forKey: "logBoxPresetValue")
        return enabled
    }

    /// Toggle the Lynx element inspector (devtool) on `LynxEnv`. Returns the
    /// new value. No-op-safe — `LynxEnv.devtoolEnabled` always exists, so this
    /// is the one toggle guaranteed to take effect.
    @discardableResult
    public static func setInspectorEnabled(_ enabled: Bool) -> Bool {
        LynxEnv.sharedInstance().devtoolEnabled = enabled
        return enabled
    }
}
