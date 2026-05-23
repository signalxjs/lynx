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
// Class is NOT marked `@objc` — Swift forbids that on generic subclasses
// (`LynxUI<__covariant V>` is an ObjC lightweight generic, so this is one).
// Member-level `@objc` / `@objc(name)` annotations still bridge because
// `LynxUI` itself is `@objc`, so the inherited ObjC machinery picks up
// `__lynx_prop_config__*` and `__lynx_ui_method_config__*` class methods
// as expected by `LynxPropsProcessor` / `LynxUIMethodProcessor`.
public class SigxWebViewUI: LynxUI<WKWebView> {

    /// `WKUserContentController` handler name. On the page side this is
    /// reached via `window.webkit.messageHandlers.sigxBridge.postMessage(...)`
    /// (WKWebView's standard surface). The user script injected by this
    /// component then aliases the friendlier `window.sigx.postMessage(...)`
    /// on top of it so authors get the same API as on Android. Keep in
    /// sync with `bridgeUserScript`.
    private static let bridgeName = "sigxBridge"

    private lazy var navigationDelegate = SigxWebViewNavigationDelegate(owner: self)
    private lazy var scriptMessageHandler = SigxWebViewScriptMessageHandler(owner: self)

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
        NSLog("[SigxWebView] createView built WKWebView=\(webView)")
        return webView
    }

    public override func frameDidChange() {
        super.frameDidChange()
        NSLog("[SigxWebView] frameDidChange frame=\(frame) view=\(view())")
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
        view().load(URLRequest(url: url))
    }

    @objc(__lynx_prop_config__src)
    public class func __lynxPropConfigSrc() -> [String] {
        return ["src", "setSrc", "NSString *"]
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
        view().loadHTMLString(raw, baseURL: nil)
    }

    @objc(__lynx_prop_config__html)
    public class func __lynxPropConfigHtml() -> [String] {
        return ["html", "setHtml", "NSString *"]
    }

    @objc public func setUserAgent(_ value: NSString?, requestReset: Bool) {
        // `view()` is lazily built — calling it from a prop setter is safe
        // because LynxUI has already created the underlying view by the
        // time the runtime hands us prop values. No "view not built yet"
        // branch needed.
        let ua = (value as String?) ?? ""
        view().customUserAgent = ua.isEmpty ? nil : ua
    }

    @objc(__lynx_prop_config__user_agent)
    public class func __lynxPropConfigUserAgent() -> [String] {
        return ["user-agent", "setUserAgent", "NSString *"]
    }

    @objc public func setEnableDebug(_ value: Bool, requestReset: Bool) {
        // iOS 16.4+ exposes `isInspectable` for the Safari Web Inspector. On
        // older iOS, the WebKit-private `developerExtrasEnabled` preference is
        // gated behind App-Store-reject risk; we only flip the public flag.
        if #available(iOS 16.4, *) {
            view().isInspectable = value
        }
    }

    @objc(__lynx_prop_config__enable_debug)
    public class func __lynxPropConfigEnableDebug() -> [String] {
        return ["enable-debug", "setEnableDebug", "BOOL"]
    }

    // MARK: - Imperative methods
    //
    // Each method is declared the same way as v1's prop setters: a Swift
    // instance method matching the macro-generated `<name>:withResult:`
    // signature plus a `@objc(__lynx_ui_method_config__<name>)` class method
    // returning the method name as an NSString. Lynx's
    // `LynxUIMethodProcessor` introspects every class method whose selector
    // begins with `__lynx_ui_method_config__` to build its dispatch table
    // (see `Pods/Lynx/.../LynxUIMethodProcessor.h`).
    //
    // Status codes: `kUIMethodSuccess = 0`, `kUIMethodUnknown = 1`. Defined
    // as raw Int32 here so we don't have to import the C enum — the values
    // are stable across Lynx 3.x.

    private static let kUIMethodSuccess: Int32 = 0
    private static let kUIMethodUnknown: Int32 = 1

    @objc public func goBack(_ params: NSDictionary?, withResult callback: @escaping LynxUIMethodCallbackBlock) {
        DispatchQueue.main.async {
            if self.view().canGoBack { self.view().goBack() }
            callback(SigxWebViewUI.kUIMethodSuccess, nil)
        }
    }
    @objc(__lynx_ui_method_config__goBack)
    public class func __lynxUIMethodConfigGoBack() -> NSString { return "goBack" }

    @objc public func goForward(_ params: NSDictionary?, withResult callback: @escaping LynxUIMethodCallbackBlock) {
        DispatchQueue.main.async {
            if self.view().canGoForward { self.view().goForward() }
            callback(SigxWebViewUI.kUIMethodSuccess, nil)
        }
    }
    @objc(__lynx_ui_method_config__goForward)
    public class func __lynxUIMethodConfigGoForward() -> NSString { return "goForward" }

    @objc public func reload(_ params: NSDictionary?, withResult callback: @escaping LynxUIMethodCallbackBlock) {
        DispatchQueue.main.async {
            self.view().reload()
            callback(SigxWebViewUI.kUIMethodSuccess, nil)
        }
    }
    @objc(__lynx_ui_method_config__reload)
    public class func __lynxUIMethodConfigReload() -> NSString { return "reload" }

    @objc public func stopLoading(_ params: NSDictionary?, withResult callback: @escaping LynxUIMethodCallbackBlock) {
        DispatchQueue.main.async {
            self.view().stopLoading()
            callback(SigxWebViewUI.kUIMethodSuccess, nil)
        }
    }
    @objc(__lynx_ui_method_config__stopLoading)
    public class func __lynxUIMethodConfigStopLoading() -> NSString { return "stopLoading" }

    @objc public func canGoBack(_ params: NSDictionary?, withResult callback: @escaping LynxUIMethodCallbackBlock) {
        DispatchQueue.main.async {
            callback(SigxWebViewUI.kUIMethodSuccess, ["value": self.view().canGoBack])
        }
    }
    @objc(__lynx_ui_method_config__canGoBack)
    public class func __lynxUIMethodConfigCanGoBack() -> NSString { return "canGoBack" }

    @objc public func canGoForward(_ params: NSDictionary?, withResult callback: @escaping LynxUIMethodCallbackBlock) {
        DispatchQueue.main.async {
            callback(SigxWebViewUI.kUIMethodSuccess, ["value": self.view().canGoForward])
        }
    }
    @objc(__lynx_ui_method_config__canGoForward)
    public class func __lynxUIMethodConfigCanGoForward() -> NSString { return "canGoForward" }

    /// Evaluate arbitrary JS in the page and return the last-expression
    /// value. Results are stringified — JS code that returns a non-string
    /// (number, dict, undefined) lands as its `String(describing:)` form so
    /// the wire shape stays predictable.
    @objc public func injectJavaScript(_ params: NSDictionary?, withResult callback: @escaping LynxUIMethodCallbackBlock) {
        let code = (params?["code"] as? String) ?? ""
        if code.isEmpty {
            callback(SigxWebViewUI.kUIMethodUnknown, "injectJavaScript: missing `code` param")
            return
        }
        DispatchQueue.main.async {
            self.view().evaluateJavaScript(code) { result, error in
                if let error = error {
                    callback(SigxWebViewUI.kUIMethodUnknown, error.localizedDescription)
                    return
                }
                // Normalise JS `null` / `undefined` → empty string for
                // wire-shape parity with Android and the documented
                // `null/undefined → ""` contract. WKWebView returns:
                //   - `nil`     for `undefined`
                //   - `NSNull`  for JS `null`
                //   - the boxed value otherwise (NSString, NSNumber, …).
                // The default `String(describing: NSNull())` of "<null>"
                // would leak into JS otherwise.
                let str: String
                if result == nil || result is NSNull {
                    str = ""
                } else if let s = result as? String {
                    str = s
                } else {
                    str = "\(result!)"
                }
                callback(SigxWebViewUI.kUIMethodSuccess, ["result": str])
            }
        }
    }
    @objc(__lynx_ui_method_config__injectJavaScript)
    public class func __lynxUIMethodConfigInjectJavaScript() -> NSString { return "injectJavaScript" }

    /// Host → page message. The user-script (`bridgeUserScript`) injects a
    /// `window.sigxBridge.dispatchMessage(data)` helper that no-ops when the
    /// page hasn't subscribed via `window.sigx.onmessage = …`. We pass the
    /// payload through `JSON.stringify` on the host side so embedded quotes
    /// don't break the eval'd JS literal.
    @objc public func postMessage(_ params: NSDictionary?, withResult callback: @escaping LynxUIMethodCallbackBlock) {
        let data = (params?["data"] as? String) ?? ""
        // Encode as JSON string literal so any quotes / newlines in the
        // payload survive the round-trip into the JS source.
        guard let payloadData = try? JSONSerialization.data(withJSONObject: [data], options: []),
              let arrayLiteral = String(data: payloadData, encoding: .utf8),
              arrayLiteral.count >= 2 else {
            callback(SigxWebViewUI.kUIMethodUnknown, "postMessage: failed to encode payload")
            return
        }
        // Slice off the array brackets to extract just the quoted-string form.
        let jsLiteral = String(arrayLiteral.dropFirst().dropLast())
        let js = "window.sigxBridge && window.sigxBridge.dispatchMessage && window.sigxBridge.dispatchMessage(\(jsLiteral));"
        DispatchQueue.main.async {
            self.view().evaluateJavaScript(js) { _, error in
                if let error = error {
                    callback(SigxWebViewUI.kUIMethodUnknown, error.localizedDescription)
                } else {
                    callback(SigxWebViewUI.kUIMethodSuccess, nil)
                }
            }
        }
    }
    @objc(__lynx_ui_method_config__postMessage)
    public class func __lynxUIMethodConfigPostMessage() -> NSString { return "postMessage" }

    // MARK: - Event firing

    /// Dispatch a `bind<name>` custom event with the given detail. JS handlers
    /// see `event.detail` carrying the params.
    fileprivate func fireEvent(_ name: String, params: [String: Any]) {
        let event = LynxCustomEvent(name: name, targetSign: sign, params: params)
        // Swift renames the ObjC `sendCustomEvent:` selector to `send(_:)`
        // when LynxCustomEvent is the parameter type — both ObjC and Swift
        // call the same underlying method.
        context?.eventEmitter?.send(event)
    }

    /// User-script injected at `documentStart` on every frame. Forwards
    /// `window.sigx.postMessage(json)` calls to the native script-message
    /// handler (page → host direction). Also exposes
    /// `window.sigxBridge.dispatchMessage` — the host calls this via
    /// `evaluateJavaScript` to deliver host → page messages, which forwards
    /// to whatever handler the page registered as `window.sigx.onmessage`.
    private static let bridgeUserScript: String = """
    (function() {
        var bridgeNs = window.sigxBridge = window.sigxBridge || {};
        var raw = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.sigxBridge;
        var post = function(payload) {
            if (!raw) return;
            try { raw.postMessage(typeof payload === 'string' ? payload : JSON.stringify(payload)); }
            catch (e) { /* raw.postMessage already serialised the error */ }
        };
        // Host → page delivery slot. No-op if the page hasn't subscribed,
        // and any handler exception is swallowed so a bad page can't break
        // the bridge.
        bridgeNs.dispatchMessage = function(payload) {
            try {
                var fn = window.sigx && window.sigx.onmessage;
                if (typeof fn === 'function') fn(payload);
            } catch (e) { /* swallowed */ }
        };
        window.sigx = window.sigx || {};
        if (!window.sigx.postMessage) window.sigx.postMessage = post;
    })();
    """
}

/// `WKNavigationDelegate` adapter that re-fires lifecycle events back to JS.
final class SigxWebViewNavigationDelegate: NSObject, WKNavigationDelegate {
    private weak var owner: SigxWebViewUI?

    init(owner: SigxWebViewUI) { self.owner = owner }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let url = webView.url?.absoluteString ?? ""
        NSLog("[SigxWebView] didFinish url=\(url) webViewFrame=\(webView.frame) superview=\(String(describing: webView.superview)) hidden=\(webView.isHidden) alpha=\(webView.alpha)")
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
