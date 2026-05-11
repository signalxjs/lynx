import Foundation
import Lynx

/// Persistent key-value storage module (UserDefaults-backed).
/// JS usage: NativeModules.Storage.setItem("key", "value")
class StorageModule: NSObject, LynxModule {

    @objc static var name: String { "Storage" }

    @objc static var methodLookup: [String: String] {
        [
            "setItem": NSStringFromSelector(#selector(setItem(_:value:))),
            "getItem": NSStringFromSelector(#selector(getItem(_:callback:))),
            "removeItem": NSStringFromSelector(#selector(removeItem(_:))),
            "clear": NSStringFromSelector(#selector(clear)),
            "getAllKeys": NSStringFromSelector(#selector(getAllKeys(_:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    private lazy var defaults: UserDefaults = {
        UserDefaults(suiteName: "com.sigx.lynxgo.storage") ?? .standard
    }()

    @objc func setItem(_ key: String?, value: String?) {
        guard let key = key else { return }
        defaults.set(value, forKey: key)
    }

    @objc func getItem(_ key: String?, callback: LynxCallbackBlock?) {
        let value: String? = key != nil ? defaults.string(forKey: key!) : nil
        callback?(value as Any)
    }

    @objc func removeItem(_ key: String?) {
        guard let key = key else { return }
        defaults.removeObject(forKey: key)
    }

    @objc func clear() {
        guard let domain = defaults.persistentDomain(forName: "com.sigx.lynxgo.storage") else { return }
        for key in domain.keys {
            defaults.removeObject(forKey: key)
        }
    }

    @objc func getAllKeys(_ callback: LynxCallbackBlock?) {
        let keys = Array(defaults.dictionaryRepresentation().keys)
        callback?(keys)
    }
}
