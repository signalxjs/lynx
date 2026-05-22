import Foundation
import UIKit
import WebKit
import Lynx

/// Native UI for the `<sigx-webview>` JSX element.
///
/// Registered via the autolinker — `signalx-module.json`'s `ios.uiComponents`
/// produces a `config.registerUI(SigxWebViewUI.self, withName: "sigx-webview")`
/// call in the generated `GeneratedComponentRegistry.swift`.
///
/// Prop / event surface (v1):
///   - `src`           → load a URL
///   - `html`          → load inline HTML
///   - `user-agent`    → custom UA string
///   - `enable-debug`  → Web Inspector (iOS 16.4+ also flips `isInspectable`)
///   - `bindload`      → page finished loading
///   - `binderror`     → load failed
///   - `bindmessage`   → page called `window.sigx.postMessage(payload)`
///
/// Imperative methods (goBack / reload / postMessage from JS / injectJavaScript)
/// are tracked as a v2 follow-up — they need the Lynx UIMethodInvoker surface.
@objc public class SigxWebViewUI: LynxUI<WKWebView> {

    /// `WKUserContentController` handler name. On the page side this is
    /// reached via `window.webkit.messageHandlers.sigxBridge.postMessage(...)`
    /// (WKWebView's standard surface). The user script injected by this
    /// component then aliases the friendlier `window.sigx.postMessage(...)`
    /// on top of it so authors get the same API as on Android. Keep in
    /// sync with `bridgeUserScript`.
    private static let bridgeName = "sigxBridge"

    private lazy var navigationDelegate = SigxWebViewNavigationDelegate(owner: self)
    private lazy var scriptMessageHandler = SigxWebViewScriptMessageHandler(owner: self)
    private var pendingUserAgent: String?

    // MARK: - LynxUI overrides

    public override func createView() -> WKWebView? {
        let config = WKWebViewConfiguration()
        let controller = WKUserContentController()
        controller.add(scriptMessageHandler, name: SigxWebViewUI.bridgeName)
        controller.addUserScript(WKUserScript(
            source: SigxWebViewUI.bridgeUserScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        ))
        config.userContentController = controller

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = navigationDelegate
        if let ua = pendingUserAgent {
            webView.customUserAgent = ua
            pendingUserAgent = nil
        }
        return webView
    }

    // MARK: - Prop setters
    //
    // Each `@objc(...)` selector matches the runtime's `__lynx_prop_config__*`
    // discovery convention from `LynxPropsProcessor.h`. The corresponding
    // setter follows the macro shape:
    //     -(void)set<Name>:(type)value requestReset:(BOOL)requestReset
    // which Swift emits naturally for `@objc func setX(_:requestReset:)`.

    @objc public func setSrc(_ value: NSString?, requestReset: Bool) {
        guard let raw = value as String?, !raw.isEmpty, let url = URL(string: raw) else { return }
        guard SigxWebViewUI.isSchemeAllowed(url) else {
            NSLog("[SigxWebView] Rejected src with unsupported scheme: \(raw.prefix(32))")
            return
        }
        view.load(URLRequest(url: url))
    }

    @objc(__lynx_prop_config__src)
    public class func __lynxPropConfigSrc() -> [String] {
        return ["src", "setSrc:requestReset:", "NSString *"]
    }

    /// Allow only `http(s)` and `about:blank`. `javascript:` is the headline
    /// XSS vector — a redirect from a remote page could execute arbitrary JS
    /// in the WebView's context. `file:` is rejected so the embedded page
    /// can't read app-bundle resources. Apps that need other schemes can
    /// use the `html` prop (no base URL → no file access) instead.
    static func isSchemeAllowed(_ url: URL) -> Bool {
        if url.absoluteString.caseInsensitiveCompare("about:blank") == .orderedSame {
            return true
        }
        guard let scheme = url.scheme?.lowercased() else { return false }
        return scheme == "http" || scheme == "https"
    }

    @objc public func setHtml(_ value: NSString?, requestReset: Bool) {
        guard let raw = value as String? else { return }
        view.loadHTMLString(raw, baseURL: nil)
    }

    @objc(__lynx_prop_config__html)
    public class func __lynxPropConfigHtml() -> [String] {
        return ["html", "setHtml:requestReset:", "NSString *"]
    }

    @objc public func setUserAgent(_ value: NSString?, requestReset: Bool) {
        let ua = (value as String?) ?? ""
        if let webView = view as WKWebView? {
            webView.customUserAgent = ua.isEmpty ? nil : ua
        } else {
            // View not built yet — stash for createView().
            pendingUserAgent = ua.isEmpty ? nil : ua
        }
    }

    @objc(__lynx_prop_config__user_agent)
    public class func __lynxPropConfigUserAgent() -> [String] {
        return ["user-agent", "setUserAgent:requestReset:", "NSString *"]
    }

    @objc public func setEnableDebug(_ value: Bool, requestReset: Bool) {
        // iOS 16.4+ exposes `isInspectable` for the Safari Web Inspector. On
        // older iOS, the WebKit-private `developerExtrasEnabled` preference is
        // gated behind App-Store-reject risk; we only flip the public flag.
        if #available(iOS 16.4, *) {
            view.isInspectable = value
        }
    }

    @objc(__lynx_prop_config__enable_debug)
    public class func __lynxPropConfigEnableDebug() -> [String] {
        return ["enable-debug", "setEnableDebug:requestReset:", "BOOL"]
    }

    // MARK: - Event firing

    /// Dispatch a `bind<name>` custom event with the given detail. JS handlers
    /// see `event.detail` carrying the params.
    fileprivate func fireEvent(_ name: String, params: [String: Any]) {
        let event = LynxCustomEvent(name: name, targetSign: sign, params: params)
        context?.eventEmitter?.sendCustomEvent(event)
    }

    /// User-script injected at `documentStart` on every frame. Forwards
    /// `window.sigx.postMessage(json)` calls to the native script-message
    /// handler. The native side parses + dispatches as `bindmessage`.
    private static let bridgeUserScript: String = """
    (function() {
        if (window.sigx && window.sigx.postMessage) return;
        var raw = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.sigxBridge;
        if (!raw) return;
        var post = function(payload) {
            try { raw.postMessage(typeof payload === 'string' ? payload : JSON.stringify(payload)); }
            catch (e) { /* swallowed; raw.postMessage already serialised the error */ }
        };
        window.sigx = window.sigx || {};
        window.sigx.postMessage = post;
    })();
    """
}

/// `WKNavigationDelegate` adapter that re-fires lifecycle events back to JS.
final class SigxWebViewNavigationDelegate: NSObject, WKNavigationDelegate {
    private weak var owner: SigxWebViewUI?

    init(owner: SigxWebViewUI) { self.owner = owner }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let url = webView.url?.absoluteString ?? ""
        owner?.fireEvent("load", params: ["url": url])
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        owner?.fireEvent("error", params: [
            "url": webView.url?.absoluteString ?? "",
            "message": error.localizedDescription,
        ])
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        // Provisional failures (DNS, TLS, unreachable) never hit didFinish;
        // surface the same shape so JS only has to wire one handler.
        owner?.fireEvent("error", params: [
            "url": webView.url?.absoluteString ?? "",
            "message": error.localizedDescription,
        ])
    }
}

/// `WKScriptMessageHandler` for `window.sigxBridge.postMessage(string)`.
/// Forwards the payload as the `data` field of a `bindmessage` event so JS
/// sees `event.detail.data` matching the Android side.
final class SigxWebViewScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var owner: SigxWebViewUI?

    init(owner: SigxWebViewUI) { self.owner = owner }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        let data: String
        if let s = message.body as? String {
            data = s
        } else {
            // Non-string bodies (numbers, dicts) — best-effort stringify so
            // the wire shape is consistent.
            data = "\(message.body)"
        }
        owner?.fireEvent("message", params: ["data": data])
    }
}
