import Foundation
import UIKit
import MapKit
import Lynx

/// Native UI for the `<sigx-map>` JSX element.
///
/// Registered via the autolinker — `signalx-module.json`'s `ios.uiComponents`
/// produces a `config.registerUI(SigxMapUI.self, withName: "sigx-map")` call
/// in the generated `GeneratedComponentRegistry.swift`.
///
/// Prop / event surface (v1):
///   - `region`               → JSON-stringified `MapRegion`
///   - `shows-user-location`  → toggle the user-location dot
///   - `map-type`             → `"standard" | "satellite" | "hybrid"`
///   - `bindregionchange`     → region changed (programmatic or user gesture)
///   - `bindpress`            → user tapped the map (not a marker)
///   - `bindmarkerpress`      → user tapped a marker
///
/// Imperative methods (animateToRegion / fitToCoordinates) are tracked as a
/// v2 follow-up — they need the Lynx UIMethodInvoker surface which isn't
/// wired through sigx-lynx yet (same blocker as WebView.goBack / reload).
// Class is NOT marked `@objc` — Swift forbids that on generic subclasses
// of an ObjC lightweight-generic type like `LynxUI<__covariant V>`. Member-
// level `@objc` / `@objc(name)` annotations still bridge because `LynxUI`
// itself is `@objc`, so `__lynx_prop_config__*` and
// `__lynx_ui_method_config__*` discovery still works.
public class SigxMapUI: LynxUI<MKMapView> {

    private lazy var mapDelegate = SigxMapDelegate(owner: self)
    private lazy var tapGesture: UITapGestureRecognizer = {
        let gr = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        gr.cancelsTouchesInView = false
        return gr
    }()
    /// Tracks the `MKPointAnnotation` per marker child so we can rebuild
    /// callout titles / coordinates in place rather than re-adding pins on
    /// every prop change.
    private var markerAnnotations: [ObjectIdentifier: MKPointAnnotation] = [:]
    /// Reverse index: annotation identity → marker UI, for translating
    /// `didSelect` callbacks back into `bindmarkerpress` events.
    private var markersByAnnotation: [ObjectIdentifier: SigxMapMarkerUI] = [:]

    // MARK: - LynxUI overrides

    public override func createView() -> MKMapView? {
        let map = MKMapView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
        map.translatesAutoresizingMaskIntoConstraints = true
        map.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        map.delegate = mapDelegate
        map.addGestureRecognizer(tapGesture)
        return map
    }

    // Explicit prop-setter registration. See SigxWebViewUI for rationale.
    @objc public class func propSetterLookUp() -> NSArray {
        return [
            ["region", "setRegion:requestReset:"],
            ["shows-user-location", "setShowsUserLocation:requestReset:"],
            ["map-type", "setMapType:requestReset:"],
        ] as NSArray
    }

    // Lynx's child-management hooks live on `LynxComponent<D>` where for
    // `LynxUI` the generic `D` is `LynxUI*`. ObjC lightweight generics
    // import into Swift as the upper bound, so the override signature uses
    // `LynxUI<UIView>` (the declared bound `__covariant V : UIView*`).
    // Both insert and remove take `atIndex` per the LynxComponent.h ABI.
    // Swift imports the ObjC `insertChild:atIndex:` selector as
    // `insertChild(_:at:)` and the same for removeChild. Override matches.
    public override func insertChild(_ child: LynxUI<UIView>!, at index: Int) {
        // Map markers participate in the Lynx UI tree as children of the map,
        // but we don't want their UIViews added to MKMapView — markers
        // render as `MKAnnotation`s on the native side. Intercept marker
        // children, register the annotation, and skip super.
        if let marker = child as? SigxMapMarkerUI {
            attachMarker(marker)
            return
        }
        super.insertChild(child, at: index)
    }

    public override func removeChild(_ child: LynxUI<UIView>!, at index: Int) {
        if let marker = child as? SigxMapMarkerUI {
            detachMarker(marker)
            return
        }
        super.removeChild(child, at: index)
    }

    // MARK: - Marker plumbing

    func attachMarker(_ marker: SigxMapMarkerUI) {
        marker.owningMap = self
        let annotation = marker.makeAnnotation()
        markerAnnotations[ObjectIdentifier(marker)] = annotation
        markersByAnnotation[ObjectIdentifier(annotation)] = marker
        view().addAnnotation(annotation)
    }

    func detachMarker(_ marker: SigxMapMarkerUI) {
        if let annotation = markerAnnotations.removeValue(forKey: ObjectIdentifier(marker)) {
            markersByAnnotation.removeValue(forKey: ObjectIdentifier(annotation))
            view().removeAnnotation(annotation)
        }
        marker.owningMap = nil
    }

    /// Called by `SigxMapMarkerUI` when its coordinate / title / description
    /// props change so the on-screen annotation reflects the new values
    /// without re-adding the pin (which would clear selection state).
    func markerDidUpdate(_ marker: SigxMapMarkerUI) {
        guard let annotation = markerAnnotations[ObjectIdentifier(marker)] else { return }
        annotation.coordinate = marker.currentCoordinate
        annotation.title = marker.currentTitle
        annotation.subtitle = marker.currentSubtitle
    }

    // MARK: - Prop setters

    @objc public func setRegion(_ value: NSString?, requestReset: Bool) {
        guard let raw = value as String?, !raw.isEmpty else { return }
        guard
            let data = raw.data(using: .utf8),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let lat = (obj["latitude"] as? NSNumber)?.doubleValue,
            let lon = (obj["longitude"] as? NSNumber)?.doubleValue,
            let latD = (obj["latitudeDelta"] as? NSNumber)?.doubleValue,
            let lonD = (obj["longitudeDelta"] as? NSNumber)?.doubleValue
        else {
            NSLog("[SigxMap] Ignoring malformed region prop: \(raw.prefix(64))")
            return
        }
        let region = MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: lat, longitude: lon),
            span: MKCoordinateSpan(latitudeDelta: latD, longitudeDelta: lonD)
        )
        view().setRegion(region, animated: false)
    }

    @objc(__lynx_prop_config__region)
    public class func __lynxPropConfigRegion() -> [String] {
        return ["region", "setRegion", "NSString *"]
    }

    @objc public func setShowsUserLocation(_ value: Bool, requestReset: Bool) {
        view().showsUserLocation = value
    }

    @objc(__lynx_prop_config__shows_user_location)
    public class func __lynxPropConfigShowsUserLocation() -> [String] {
        return ["shows-user-location", "setShowsUserLocation", "BOOL"]
    }

    @objc public func setMapType(_ value: NSString?, requestReset: Bool) {
        switch (value as String?) ?? "" {
        case "satellite": view().mapType = .satellite
        case "hybrid":    view().mapType = .hybrid
        default:          view().mapType = .standard
        }
    }

    @objc(__lynx_prop_config__map_type)
    public class func __lynxPropConfigMapType() -> [String] {
        return ["map-type", "setMapType", "NSString *"]
    }

    // MARK: - Gesture handling

    @objc private func handleTap(_ gr: UITapGestureRecognizer) {
        let map = view()
        let point = gr.location(in: map)
        // Skip taps on the existing annotations — those are surfaced via
        // didSelect in the delegate as `bindmarkerpress`.
        if map.hitTest(point, with: nil) is MKAnnotationView { return }
        let coord = map.convert(point, toCoordinateFrom: map)
        fireEvent("press", params: [
            "coordinate": [
                "latitude": coord.latitude,
                "longitude": coord.longitude,
            ],
        ])
    }

    // MARK: - Event firing

    internal func fireEvent(_ name: String, params: [String: Any]) {
        let event = LynxCustomEvent(name: name, targetSign: sign, params: params)
        // Swift renames the ObjC `sendCustomEvent:` selector to `send(_:)`
        // when LynxCustomEvent is the parameter type — same underlying method.
        context?.eventEmitter?.send(event)
    }

    internal func emitRegionChange(_ region: MKCoordinateRegion) {
        fireEvent("regionchange", params: [
            "region": [
                "latitude": region.center.latitude,
                "longitude": region.center.longitude,
                "latitudeDelta": region.span.latitudeDelta,
                "longitudeDelta": region.span.longitudeDelta,
            ],
        ])
    }

    internal func emitMarkerPress(_ marker: SigxMapMarkerUI) {
        fireEvent("markerpress", params: [
            "id": marker.markerId,
            "coordinate": [
                "latitude": marker.currentCoordinate.latitude,
                "longitude": marker.currentCoordinate.longitude,
            ],
        ])
    }

    internal func marker(for annotation: MKAnnotation) -> SigxMapMarkerUI? {
        guard let obj = annotation as? AnyObject else { return nil }
        return markersByAnnotation[ObjectIdentifier(obj)]
    }
}

/// `MKMapViewDelegate` forwarder — keeps the public class slim and avoids
/// the `NSObject` Obj-C runtime drag on `SigxMapUI` itself.
final class SigxMapDelegate: NSObject, MKMapViewDelegate {
    private weak var owner: SigxMapUI?

    init(owner: SigxMapUI) { self.owner = owner }

    func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
        owner?.emitRegionChange(mapView.region)
    }

    func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
        guard let annotation = view.annotation, let marker = owner?.marker(for: annotation) else { return }
        owner?.emitMarkerPress(marker)
    }
}
