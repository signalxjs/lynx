import Foundation
import Lynx
import Security
import LocalAuthentication

/// Encrypted KV storage backed by the iOS Keychain.
///
/// JS usage: `NativeModules.SecureStorage.<method>(...)`.
///
/// All items are stored as `kSecClassGenericPassword` with a per-bundle
/// service identifier. Items requested with `requireBiometric: true` are
/// stored with a `SecAccessControl` of `.biometryCurrentSet`, which causes
/// `SecItemCopyMatching` to show the OS biometric prompt automatically on
/// read. Non-biometric items use `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`
/// so they never appear in iCloud or encrypted iTunes backups.
class SecureStorageModule: NSObject, LynxModule {

    @objc static var name: String { "SecureStorage" }

    @objc static var methodLookup: [String: String] {
        [
            "set": NSStringFromSelector(#selector(set(_:value:options:callback:))),
            "get": NSStringFromSelector(#selector(get(_:options:callback:))),
            "delete": NSStringFromSelector(#selector(delete(_:callback:))),
            "clear": NSStringFromSelector(#selector(clear(_:))),
            "hasKey": NSStringFromSelector(#selector(hasKey(_:callback:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    private var service: String {
        // Namespacing the service id with `.sigx.secure-storage` keeps our
        // items separate from anything else the host app stores in the
        // Keychain (other libraries, host SDKs).
        let bundleId = Bundle.main.bundleIdentifier ?? "com.sigx.app"
        return "\(bundleId).sigx.secure-storage"
    }

    @objc func set(
        _ key: String?,
        value: String?,
        options: [String: Any]?,
        callback: LynxCallbackBlock?,
    ) {
        guard let key = key, !key.isEmpty else {
            callback?(["error": "key is required"])
            return
        }
        guard let value = value, let data = value.data(using: .utf8) else {
            callback?(["error": "value must be a string"])
            return
        }
        let requireBiometric = (options?["requireBiometric"] as? Bool) ?? false

        // Delete any prior entry under this key — `SecItemUpdate` can't
        // change `kSecAttrAccessControl`, so we always wipe + add.
        let baseQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(baseQuery as CFDictionary)

        var addQuery: [String: Any] = baseQuery
        addQuery[kSecValueData as String] = data

        if requireBiometric {
            var acError: Unmanaged<CFError>?
            guard let access = SecAccessControlCreateWithFlags(
                kCFAllocatorDefault,
                kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
                .biometryCurrentSet,
                &acError,
            ) else {
                let err = acError?.takeRetainedValue() as Error?
                callback?([
                    "error": "Failed to create SecAccessControl: \(err?.localizedDescription ?? "unknown")"
                ])
                return
            }
            addQuery[kSecAttrAccessControl as String] = access
        } else {
            addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        }

        let status = SecItemAdd(addQuery as CFDictionary, nil)
        if status == errSecSuccess {
            callback?(["ok": true])
        } else {
            callback?(["error": "SecItemAdd failed: \(status)"])
        }
    }

    @objc func get(
        _ key: String?,
        options: [String: Any]?,
        callback: LynxCallbackBlock?,
    ) {
        guard let key = key, !key.isEmpty else {
            callback?(["error": "key is required"])
            return
        }

        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        // Always supply an LAContext so a biometric-gated item produces a
        // visible OS prompt — without an explicit context, the Keychain
        // query for an item stored with `.biometryCurrentSet` can fail
        // outright instead of presenting UI. For non-biometric items the
        // context is harmless (no prompt is shown).
        let context = LAContext()
        let reason = (options?["biometricPrompt"] as? [String: Any])?["reason"] as? String
        context.localizedReason = (reason?.isEmpty == false ? reason : "Authenticate to read secure data") ?? "Authenticate to read secure data"
        query[kSecUseAuthenticationContext as String] = context

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        switch status {
        case errSecSuccess:
            if let data = result as? Data, let value = String(data: data, encoding: .utf8) {
                callback?(["value": value])
            } else {
                callback?(["value": NSNull()])
            }
        case errSecItemNotFound:
            callback?(["value": NSNull()])
        case errSecUserCanceled, -128:
            callback?(["error": "userCancel"])
        case errSecAuthFailed:
            callback?(["error": "authenticationFailed"])
        default:
            callback?(["error": "SecItemCopyMatching failed: \(status)"])
        }
    }

    @objc func delete(_ key: String?, callback: LynxCallbackBlock?) {
        guard let key = key, !key.isEmpty else {
            callback?(["error": "key is required"])
            return
        }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            callback?(["ok": true])
        } else {
            callback?(["error": "SecItemDelete failed: \(status)"])
        }
    }

    @objc func clear(_ callback: LynxCallbackBlock?) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            callback?(["ok": true])
        } else {
            callback?(["error": "SecItemDelete failed: \(status)"])
        }
    }

    @objc func hasKey(_ key: String?, callback: LynxCallbackBlock?) {
        guard let key = key, !key.isEmpty else {
            callback?(["exists": false])
            return
        }
        // `kSecUseAuthenticationUIFail` makes the query return without
        // prompting when an ACL would normally require auth — we just want
        // to know if the item exists, not to read it.
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: false,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail,
        ]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        // errSecInteractionNotAllowed (-25308) means the item exists but
        // needs UI we suppressed — count it as "exists".
        let exists = status == errSecSuccess || status == -25308
        callback?(["exists": exists])
    }
}
