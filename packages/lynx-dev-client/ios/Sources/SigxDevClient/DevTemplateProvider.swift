import Foundation
import Lynx

/// Loads Lynx bundles from URLs (dev server) or local assets.
/// Implements LynxTemplateProvider protocol.
class DevTemplateProvider: NSObject, LynxTemplateProvider {

    func loadTemplate(withUrl url: String!, onComplete callback: ((Any?, Error?) -> Void)!) {
        guard let callback = callback else { return }

        if url.hasPrefix("http://") || url.hasPrefix("https://") {
            loadFromURL(url, callback: callback)
        } else {
            loadFromAssets(url, callback: callback)
        }
    }

    private func loadFromURL(_ urlString: String, callback: @escaping (Any?, Error?) -> Void) {
        guard let url = URL(string: urlString) else {
            let error = NSError(
                domain: "com.sigx.devclient",
                code: 400,
                userInfo: [NSLocalizedDescriptionKey: "Invalid URL: \(urlString)"]
            )
            callback(nil, error)
            return
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 30

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                callback(nil, error)
                return
            }
            guard let data = data else {
                let error = NSError(
                    domain: "com.sigx.devclient",
                    code: 404,
                    userInfo: [NSLocalizedDescriptionKey: "No data received from \(urlString)"]
                )
                callback(nil, error)
                return
            }
            callback(data, nil)
        }.resume()
    }

    private func loadFromAssets(_ name: String, callback: @escaping (Any?, Error?) -> Void) {
        guard let path = Bundle.main.path(forResource: name, ofType: nil) else {
            let error = NSError(
                domain: "com.sigx.devclient",
                code: 404,
                userInfo: [NSLocalizedDescriptionKey: "Asset not found: \(name)"]
            )
            callback(nil, error)
            return
        }

        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: path))
            callback(data, nil)
        } catch {
            callback(nil, error)
        }
    }
}
