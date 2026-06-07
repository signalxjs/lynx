import Foundation
import Lynx

/// Native HTTP bridge — JS-callable side.
///
/// JS usage (via the `@sigx/lynx-http` fetch shim, not directly):
///
///   NativeModules.Http.request(id, spec, cb)   // cb acks dispatch
///   NativeModules.Http.abort(id, cb)
///
/// `spec` is the `NativeRequestSpec` from `src/types.ts`. All outcomes are
/// pushed back via `HttpEventBus` (response → progress* → chunk* →
/// done | error), which a per-LynxView `HttpPublisher` forwards to JS
/// through `LynxView.sendGlobalEvent("__sigxHttpEvent", [...])`.
@objc class HttpModule: NSObject, LynxModule {

    @objc static var name: String { "Http" }

    @objc static var methodLookup: [String: String] {
        [
            "request": NSStringFromSelector(#selector(request(_:spec:callback:))),
            "abort":   NSStringFromSelector(#selector(abort(_:callback:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    @objc func request(_ id: NSNumber, spec: [String: Any]?, callback: LynxCallbackBlock?) {
        guard let spec = spec else {
            callback?(["error": "request spec is required"])
            return
        }
        HttpTaskStore.shared.start(id: id.intValue, spec: spec)
        callback?(NSNull())
    }

    @objc func abort(_ id: NSNumber, callback: LynxCallbackBlock?) {
        HttpTaskStore.shared.abort(id: id.intValue)
        callback?(NSNull())
    }
}
