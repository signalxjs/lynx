import Foundation
import Lynx

/// Resolves embedded Lynx assets (async chunks from dynamic `import()`) in
/// production builds. `sigx run:ios --release` / `sigx prebuild --embed-bundle`
/// mirror `dist/static/js/async/**` into the app bundle's `LynxAssets/` folder;
/// the fetchers below map the runtime's root-relative request URLs
/// (`/static/js/async/<hash>.js`) back onto those files. (#599)
enum SigxEmbeddedAssets {
    /// Extra search roots checked before the app bundle, highest priority
    /// first — e.g. an OTA update's directory, so a downloaded bundle can ship
    /// its own chunks in the future.
    static var searchRoots: [URL] = []

    static func resolve(_ urlString: String) -> URL? {
        guard let rel = relativePath(from: urlString) else { return nil }
        for root in searchRoots {
            let candidate = root.appendingPathComponent(rel)
            if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
        }
        if let candidate = Bundle.main.resourceURL?.appendingPathComponent("LynxAssets/\(rel)"),
           FileManager.default.fileExists(atPath: candidate.path) {
            return candidate
        }
        return nil
    }

    /// Map a chunk request URL to its dist-relative asset path. Accepts
    /// root-relative paths (`/static/js/async/x.js`), absolute URLs with any
    /// scheme/host (custom assetPrefix), and bare relative paths. The
    /// `static/` marker fallback keeps CDN-prefixed URLs resolvable offline.
    static func relativePath(from urlString: String) -> String? {
        var path = urlString
        if let url = URL(string: urlString), url.scheme != nil {
            path = url.path
        }
        let trimmed = String(path.drop(while: { $0 == "/" }))
        if trimmed.isEmpty { return nil }
        if trimmed.hasPrefix("static/") { return trimmed }
        if let range = trimmed.range(of: "static/js/async/") {
            return String(trimmed[range.lowerBound...])
        }
        return trimmed
    }
}

/// Serves dynamic-import chunks (`lynx.requireModuleAsync`) from embedded
/// assets in production. Without a registered generic resource fetcher the
/// engine rejects every external JS request with "No available provider or
/// fetcher". Remote http(s) URLs (custom assetPrefix pointing at a CDN) fall
/// back to the network.
final class ProductionGenericResourceFetcher: NSObject, LynxGenericResourceFetcher {

    func fetchResource(
        _ request: LynxResourceRequest,
        onComplete callback: @escaping LynxGenericResourceCompletionBlock
    ) -> (() -> Void)! {
        let urlString = request.url ?? ""

        if let local = SigxEmbeddedAssets.resolve(urlString) {
            do {
                callback(try Data(contentsOf: local), nil)
            } catch {
                callback(nil, error)
            }
            return {}
        }

        if let url = URL(string: urlString), url.scheme == "http" || url.scheme == "https" {
            let task = URLSession.shared.dataTask(with: url) { data, _, error in
                callback(data, error)
            }
            task.resume()
            return { task.cancel() }
        }

        callback(nil, NSError(domain: "com.sigx", code: 404, userInfo: [
            NSLocalizedDescriptionKey:
                "No embedded asset for \(urlString). Rebuild with `sigx run:ios --release` "
                + "(or `sigx prebuild --embed-bundle` after `sigx build`) so async chunks are embedded.",
        ]))
        return {}
    }

    func fetchResourcePath(
        _ request: LynxResourceRequest,
        onComplete callback: @escaping LynxGenericResourcePathCompletionBlock
    ) -> (() -> Void)! {
        if let local = SigxEmbeddedAssets.resolve(request.url ?? "") {
            callback(local.path, nil)
        } else {
            callback(nil, NSError(domain: "com.sigx", code: 404, userInfo: [
                NSLocalizedDescriptionKey: "No embedded asset for \(request.url ?? "")",
            ]))
        }
        return {}
    }
}

/// Template counterpart of `ProductionGenericResourceFetcher` — some engine
/// paths fetch template-typed resources through this hook instead.
final class ProductionTemplateResourceFetcher: NSObject, LynxTemplateResourceFetcher {

    func fetchTemplate(
        _ request: LynxResourceRequest,
        onComplete callback: @escaping (LynxTemplateResource?, Error?) -> Void
    ) {
        let urlString = request.url ?? ""

        if let local = SigxEmbeddedAssets.resolve(urlString) {
            do {
                callback(LynxTemplateResource(nsData: try Data(contentsOf: local)), nil)
            } catch {
                callback(nil, error)
            }
            return
        }

        if let url = URL(string: urlString), url.scheme == "http" || url.scheme == "https" {
            URLSession.shared.dataTask(with: url) { data, _, error in
                if let data = data {
                    callback(LynxTemplateResource(nsData: data), nil)
                } else {
                    callback(nil, error)
                }
            }.resume()
            return
        }

        callback(nil, NSError(domain: "com.sigx", code: 404, userInfo: [
            NSLocalizedDescriptionKey: "No embedded template for \(urlString)",
        ]))
    }

    func fetchSSRData(
        _ request: LynxResourceRequest,
        onComplete callback: @escaping (Data?, Error?) -> Void
    ) {
        callback(nil, NSError(domain: "com.sigx", code: 501, userInfo: [
            NSLocalizedDescriptionKey: "SSR not supported",
        ]))
    }
}
