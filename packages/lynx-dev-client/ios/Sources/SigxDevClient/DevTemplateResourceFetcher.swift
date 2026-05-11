import Foundation
import Lynx

/// Handles template and HMR hot-update fetching for LynxView.
/// Required for HMR — the template provider only handles initial loads.
class DevTemplateResourceFetcher: NSObject, LynxTemplateResourceFetcher {

    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        return URLSession(configuration: config)
    }()

    func fetchTemplate(
        _ request: LynxResourceRequest,
        onComplete callback: @escaping (LynxTemplateResource?, Error?) -> Void
    ) {
        let url = request.url ?? ""

        if url.hasPrefix("file://") || (!url.hasPrefix("http://") && !url.hasPrefix("https://")) {
            fetchFromAssets(url.replacingOccurrences(of: "file://", with: ""), callback: callback)
            return
        }

        guard let requestURL = URL(string: url) else {
            callback(nil, NSError(domain: "com.sigx.devclient", code: 400,
                                  userInfo: [NSLocalizedDescriptionKey: "Invalid URL: \(url)"]))
            return
        }

        session.dataTask(with: requestURL) { data, response, error in
            if let error = error {
                callback(nil, error)
                return
            }
            guard let data = data else {
                callback(nil, NSError(domain: "com.sigx.devclient", code: 404,
                                      userInfo: [NSLocalizedDescriptionKey: "No data received"]))
                return
            }
            let resource = LynxTemplateResource(nsData: data)
            callback(resource, nil)
        }.resume()
    }

    func fetchSSRData(
        _ request: LynxResourceRequest,
        onComplete callback: @escaping (Data?, Error?) -> Void
    ) {
        // SSR not used in dev mode; return nil
        callback(nil, nil)
    }

    private func fetchFromAssets(
        _ path: String,
        callback: @escaping (LynxTemplateResource?, Error?) -> Void
    ) {
        guard let bundlePath = Bundle.main.path(forResource: path, ofType: nil) else {
            callback(nil, NSError(domain: "com.sigx.devclient", code: 404,
                                  userInfo: [NSLocalizedDescriptionKey: "Asset not found: \(path)"]))
            return
        }

        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: bundlePath))
            let resource = LynxTemplateResource(nsData: data)
            callback(resource, nil)
        } catch {
            callback(nil, error)
        }
    }
}
