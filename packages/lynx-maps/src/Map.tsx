import { component, type Define } from '@sigx/lynx';
import './jsx-augment.js';
import type {
    MapRegion,
    MapType,
    MapPressEvent,
    MapRegionChangeEvent,
    MapMarkerPressEvent,
} from './jsx-augment.js';

export type MapProps =
    & Define.Prop<'region', MapRegion, false>
    & Define.Prop<'showsUserLocation', boolean, false>
    & Define.Prop<'mapType', MapType, false>
    & Define.Prop<'class', string, false>
    & Define.Prop<'style', string | Record<string, string | number>, false>
    & Define.Prop<'onRegionChange', (e: MapRegionChangeEvent) => void, false>
    & Define.Prop<'onPress', (e: MapPressEvent) => void, false>
    & Define.Prop<'onMarkerPress', (e: MapMarkerPressEvent) => void, false>
    & Define.Prop<'children', unknown, false>;

/**
 * Native map view.
 *
 * Backed by `MKMapView` on iOS and `com.google.android.gms.maps.MapView`
 * on Android. Pass any number of `<MapMarker>` children to render pins.
 *
 * @example
 * ```tsx
 * <Map
 *   region={{
 *     latitude: 59.3293,
 *     longitude: 18.0686,
 *     latitudeDelta: 0.1,
 *     longitudeDelta: 0.1,
 *   }}
 *   showsUserLocation
 *   onRegionChange={(e) => console.log('region', e.detail.region)}
 *   onMarkerPress={(e) => console.log('marker', e.detail.id)}
 * >
 *   <MapMarker
 *     coordinate={{ latitude: 59.3293, longitude: 18.0686 }}
 *     title="Stockholm"
 *   />
 * </Map>
 * ```
 *
 * @remarks
 * - **Android API key**: Google Maps requires an API key. See this
 *   package's README for setup. The placeholder used by `sigx-lynx-go`
 *   shows the "For development purposes only" watermark — that's
 *   expected until you provide your own key.
 * - **Imperative methods** (`animateToRegion`, `fitToCoordinates`) are
 *   tracked as a v2 follow-up — they need the Lynx UIMethodInvoker
 *   surface which isn't wired through sigx-lynx yet. The same gap
 *   blocks WebView's `goBack` / `reload`.
 */
export const Map = component<MapProps>(({ props }) => {
    return () => {
        // Only attach the native string props (`region`, `map-type`) when set.
        // A JSX attribute set to `undefined` is still emitted, and the BG→MT op
        // queue serializes ops with JSON.stringify, which turns `undefined` into
        // `null` — so an unset optional reaches the native `NSString *` setter
        // as `NSNull` and crashes it (`-[NSNull length]`). Omitting the
        // attribute keeps it off the wire entirely. The native setters are also
        // hardened against `NSNull` as a backstop (covers prop removal). #475
        const nativeProps: Record<string, unknown> = {};
        if (props.region != null) nativeProps.region = JSON.stringify(props.region);
        if (props.mapType != null) nativeProps['map-type'] = props.mapType;
        return (
            <sigx-map
                {...nativeProps}
                shows-user-location={props.showsUserLocation}
                class={props.class}
                style={props.style}
                bindregionchange={props.onRegionChange}
                bindpress={props.onPress}
                bindmarkerpress={props.onMarkerPress}
            >
                {props.children}
            </sigx-map>
        );
    };
});
