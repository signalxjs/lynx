import Foundation
import UIKit
import MapKit
import Lynx

/// Native UI for the `<sigx-map-marker>` JSX element.
///
/// A marker doesn't render its own real view — Google Maps and MapKit both
/// model pins as data attached to the map. We still need a `LynxUI<UIView>`
/// because Lynx's UI tree expects every child to be a UI. The native view is
/// a zero-size hidden `UIView` that never gets laid out: the parent
/// `SigxMapUI` intercepts `insertChild` for markers and skips calling super,
/// so the dummy view is created but never attached to the map view hierarchy.
///
/// Prop surface (v1):
///   - `coordinate`  → JSON-stringified `{ latitude, longitude }`
///   - `title`       → callout title
///   - `description` → callout subtitle
///   - `marker-id`   → forwarded as `event.detail.id` on `bindmarkerpress`
// Class is NOT marked `@objc` — Swift forbids that on generic subclasses
// of an ObjC lightweight-generic type like `LynxUI<__covariant V>`. Member-
// level `@objc` / `@objc(name)` annotations still bridge because `LynxUI`
// itself is `@objc`, so `__lynx_prop_config__*` discovery still works.
public class SigxMapMarkerUI: LynxUI<UIView> {
    internal weak var owningMap: SigxMapUI?

    internal var currentCoordinate = CLLocationCoordinate2D(latitude: 0, longitude: 0)
    internal var currentTitle: String?
    internal var currentSubtitle: String?
    internal var markerId: String = ""

    public override func createView() -> UIView? {
        let v = UIView(frame: .zero)
        v.isHidden = true
        return v
    }

    // Explicit prop-setter registration. See SigxWebViewUI for rationale.
    @objc public class func propSetterLookUp() -> NSArray {
        return [
            ["coordinate", "setCoordinate:requestReset:"],
            ["title", "setTitle:requestReset:"],
            ["description", "setDescription:requestReset:"],
            ["marker-id", "setMarkerId:requestReset:"],
        ] as NSArray
    }

    internal func makeAnnotation() -> MKPointAnnotation {
        let a = MKPointAnnotation()
        a.coordinate = currentCoordinate
        a.title = currentTitle
        a.subtitle = currentSubtitle
        return a
    }

    // MARK: - Prop setters

    @objc public func setCoordinate(_ value: NSString?, requestReset: Bool) {
        guard let raw = value as String?, !raw.isEmpty,
              let data = raw.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let lat = (obj["latitude"] as? NSNumber)?.doubleValue,
              let lon = (obj["longitude"] as? NSNumber)?.doubleValue
        else { return }
        currentCoordinate = CLLocationCoordinate2D(latitude: lat, longitude: lon)
        owningMap?.markerDidUpdate(self)
    }

    @objc(__lynx_prop_config__coordinate)
    public class func __lynxPropConfigCoordinate() -> [String] {
        return ["coordinate", "setCoordinate", "NSString *"]
    }

    @objc public func setTitle(_ value: NSString?, requestReset: Bool) {
        currentTitle = value as String?
        owningMap?.markerDidUpdate(self)
    }

    @objc(__lynx_prop_config__title)
    public class func __lynxPropConfigTitle() -> [String] {
        return ["title", "setTitle", "NSString *"]
    }

    @objc public func setDescription(_ value: NSString?, requestReset: Bool) {
        currentSubtitle = value as String?
        owningMap?.markerDidUpdate(self)
    }

    @objc(__lynx_prop_config__description)
    public class func __lynxPropConfigDescription() -> [String] {
        return ["description", "setDescription", "NSString *"]
    }

    @objc public func setMarkerId(_ value: NSString?, requestReset: Bool) {
        markerId = (value as String?) ?? ""
    }

    @objc(__lynx_prop_config__marker_id)
    public class func __lynxPropConfigMarkerId() -> [String] {
        return ["marker-id", "setMarkerId", "NSString *"]
    }
}
