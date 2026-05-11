import Foundation
import Lynx

/// File system access module.
/// JS usage: NativeModules.FileSystem.readFile("data.json", callback)
class FileSystemModule: NSObject, LynxModule {

    @objc static var name: String { "FileSystem" }

    @objc static var methodLookup: [String: String] {
        [
            "readFile": NSStringFromSelector(#selector(readFile(_:callback:))),
            "writeFile": NSStringFromSelector(#selector(writeFile(_:content:callback:))),
            "deleteFile": NSStringFromSelector(#selector(deleteFile(_:callback:))),
            "getInfo": NSStringFromSelector(#selector(getInfo(_:callback:))),
            "getDocumentDirectory": NSStringFromSelector(#selector(getDocumentDirectory)),
            "getCacheDirectory": NSStringFromSelector(#selector(getCacheDirectory)),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    private let fileManager = FileManager.default

    @objc func readFile(_ path: String?, callback: LynxCallbackBlock?) {
        guard let path = path else {
            callback?(["error": "Path is required"])
            return
        }
        let resolvedPath = resolveFile(path)
        guard fileManager.fileExists(atPath: resolvedPath) else {
            callback?(["error": "File not found: \(path)"])
            return
        }
        do {
            let content = try String(contentsOfFile: resolvedPath, encoding: .utf8)
            callback?(content)
        } catch {
            callback?(["error": error.localizedDescription])
        }
    }

    @objc func writeFile(_ path: String?, content: String?, callback: LynxCallbackBlock?) {
        guard let path = path else {
            callback?(["error": "Path is required"])
            return
        }
        let resolvedPath = resolveFile(path)
        let directory = (resolvedPath as NSString).deletingLastPathComponent
        try? fileManager.createDirectory(atPath: directory, withIntermediateDirectories: true)
        do {
            try (content ?? "").write(toFile: resolvedPath, atomically: true, encoding: .utf8)
            callback?(true)
        } catch {
            callback?(["error": error.localizedDescription])
        }
    }

    @objc func deleteFile(_ path: String?, callback: LynxCallbackBlock?) {
        guard let path = path else {
            callback?(["error": "Path is required"])
            return
        }
        let resolvedPath = resolveFile(path)
        do {
            try fileManager.removeItem(atPath: resolvedPath)
            callback?(true)
        } catch {
            callback?(["error": error.localizedDescription])
        }
    }

    @objc func getInfo(_ path: String?, callback: LynxCallbackBlock?) {
        guard let path = path else {
            callback?(["error": "Path is required"])
            return
        }
        let resolvedPath = resolveFile(path)
        let exists = fileManager.fileExists(atPath: resolvedPath)
        var result: [String: Any] = ["uri": resolvedPath, "exists": exists]
        if exists, let attrs = try? fileManager.attributesOfItem(atPath: resolvedPath) {
            result["size"] = (attrs[.size] as? UInt64) ?? 0
            result["isDirectory"] = (attrs[.type] as? FileAttributeType) == .typeDirectory
            result["modifiedAt"] = (attrs[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
        }
        callback?(result)
    }

    @objc func getDocumentDirectory() -> String {
        NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true).first ?? ""
    }

    @objc func getCacheDirectory() -> String {
        NSSearchPathForDirectoriesInDomains(.cachesDirectory, .userDomainMask, true).first ?? ""
    }

    private func resolveFile(_ path: String) -> String {
        if (path as NSString).isAbsolutePath { return path }
        let docsDir = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true).first ?? ""
        return (docsDir as NSString).appendingPathComponent(path)
    }
}
