import { component, type Define } from '@sigx/lynx';
import './jsx-augment.js';
import type { MapCoordinate } from './jsx-augment.js';

export type MapMarkerProps =
    & Define.Prop<'coordinate', MapCoordinate, true>
    & Define.Prop<'title', string, false>
    & Define.Prop<'description', string, false>
    & Define.Prop<'id', string, false>;

/**
 * Marker pin on a `<Map>`.
 *
 * Coordinates are required; `title` / `description` show in the callout
 * when the user taps the marker. `id` is surfaced as
 * `event.detail.id` in the parent map's `onMarkerPress` handler — set
 * one if multiple markers share the same coordinate.
 *
 * @example
 * ```tsx
 * <Map>
 *   <MapMarker
 *     coordinate={{ latitude: 59.3293, longitude: 18.0686 }}
 *     title="Stockholm"
 *     description="Sweden's capital"
 *     id="sthlm"
 *   />
 * </Map>
 * ```
 *
 * @remarks
 * Marker pins are intentionally minimal in v1 — no custom icons, no
 * draggable pins, no callout views. Those land in v2.
 */
export const MapMarker = component<MapMarkerProps>(({ props }) => {
    return () => {
        // Only attach the optional native string props when set — an
        // `undefined` JSX attribute is serialized to `null` over the op queue
        // and crashes the native `NSString *` setter (`-[NSNull length]`).
        // `coordinate` is required, so it is always emitted. See Map.tsx / #475.
        const optionalProps: {
            title?: string;
            description?: string;
            'marker-id'?: string;
        } = {};
        if (props.title != null) optionalProps.title = props.title;
        if (props.description != null) optionalProps.description = props.description;
        if (props.id != null) optionalProps['marker-id'] = props.id;
        return (
            <sigx-map-marker
                coordinate={JSON.stringify(props.coordinate)}
                {...optionalProps}
            />
        );
    };
});
