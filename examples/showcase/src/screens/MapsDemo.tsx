import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Map as MapView, MapMarker } from '@sigx/lynx-maps';
import { Card, Text } from '@sigx/lynx-daisyui';

/**
 * Maps — @sigx/lynx-maps (Apple Maps on iOS, Google Maps on Android) with
 * a region, markers, and marker-press selection. Tapping a marker shows a
 * detail card; tapping the map clears it.
 */
const MARKERS = [
    { id: 'lisbon', lat: 38.7223, lng: -9.1393, title: 'Lisbon', description: 'Pastéis de nata HQ' },
    { id: 'kyoto', lat: 35.0116, lng: 135.7681, title: 'Kyoto', description: 'Temples and tea' },
    { id: 'oaxaca', lat: 17.0732, lng: -96.7266, title: 'Oaxaca', description: 'Mole central' },
];

/** Region centred on the markers' bounding box with ~30% padding. */
function regionFor(rows: typeof MARKERS) {
    const lats = rows.map((r) => r.lat);
    const lngs = rows.map((r) => r.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
        latitude: (minLat + maxLat) / 2,
        longitude: (minLng + maxLng) / 2,
        latitudeDelta: Math.max(0.05, (maxLat - minLat) * 1.3),
        longitudeDelta: Math.max(0.05, (maxLng - minLng) * 1.3),
    };
}

export const MapsDemo = component(() => {
    const selectedId = signal<string | null>(null);

    return () => {
        const selected = MARKERS.find((m) => m.id === selectedId.value);

        return (
            <view class="flex-fill bg-base-100">
                <Screen title="Maps" />
                <MapView
                    region={regionFor(MARKERS)}
                    showsUserLocation
                    class="flex-1"
                    onMarkerPress={(e) => {
                        selectedId.value = e.detail.id;
                    }}
                    onPress={() => {
                        selectedId.value = null;
                    }}
                >
                    {MARKERS.map((m) => (
                        <MapMarker
                            id={m.id}
                            coordinate={{ latitude: m.lat, longitude: m.lng }}
                            title={m.title}
                            description={m.description}
                        />
                    ))}
                </MapView>
                {selected && (
                    <view class="absolute bottom-4 left-4 right-4">
                        <Card bordered>
                            <Card.Body>
                                <Text weight="semibold">{selected.title}</Text>
                                <Text>{selected.description}</Text>
                                <Text class="opacity-60 text-sm">
                                    {selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}
                                </Text>
                            </Card.Body>
                        </Card>
                    </view>
                )}
            </view>
        );
    };
});
