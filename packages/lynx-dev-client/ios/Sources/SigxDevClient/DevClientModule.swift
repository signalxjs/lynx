import Foundation
import Lynx

/// Minimal JS-callable native module exposed by `@sigx/lynx-dev-client`.
///
/// Lets the JS-side console streamer ask the host runtime which platform it
/// is running on. The BG runtime does not populate `lynx.SystemInfo` and has
/// no `navigator.userAgent`, so a tiny native probe is the only reliable
/// source.
///
/// JS usage:
/// ```ts
/// import { callAsync } from '@sigx/lynx-core';
/// const { platform } = await callAsync<{ platform: string }>(
///     'DevClient', 'getPlatform',
/// );
/// ```
class DevClientModule: NSObject, LynxModule {

    @objc static var name: String { "DevClient" }

    @objc static var methodLookup: [String: String] {
        [
            "getPlatform": NSStringFromSelector(#selector(getPlatform(_:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    @objc func getPlatform(_ callback: LynxCallbackBlock?) {
        callback?(["platform": "ios"])
    }
}
