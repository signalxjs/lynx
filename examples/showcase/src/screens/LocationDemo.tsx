import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, Heading, ScrollView, Text } from '@sigx/lynx-daisyui';
import { Haptics } from '@sigx/lynx-haptics';
import { Location } from '@sigx/lynx-location';

/**
 * Location — permission request + one-shot GPS fix via @sigx/lynx-location.
 */
export const LocationDemo = component(() => {
    const status = signal<string>('idle');
    // Boxed so the union `T | null` satisfies signal's `T extends object`
    // overload.
    const fix = signal<{ value: { lat: number; lng: number; accuracy?: number } | null }>({ value: null });

    const capture = async () => {
        Haptics.selection();
        status.value = 'requesting permission…';
        try {
            const perm = await Location.requestPermission();
            if (perm.status !== 'granted') {
                status.value = `permission ${perm.status}`;
                return;
            }
            status.value = 'getting fix…';
            const pos = await Location.getCurrentPosition({
                accuracy: 'balanced',
                timeout: 5000,
            });
            fix.value = { lat: pos.latitude, lng: pos.longitude, accuracy: pos.accuracy };
            status.value = 'ok';
        } catch (err) {
            status.value = `error: ${String(err)}`;
        }
    };

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Location" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Location</Heading>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">One-shot GPS fix</Text>
                            <Text class="opacity-60 text-sm">
                                requestPermission() then getCurrentPosition()
                                with balanced accuracy and a 5s timeout.
                            </Text>
                            <Button color="primary" onPress={capture}>
                                Get current position
                            </Button>
                            <Text class="font-mono text-sm opacity-70">
                                status: {status.value}{'\n'}
                                lat: {fix.value ? fix.value.lat.toFixed(5) : '—'}{'\n'}
                                lng: {fix.value ? fix.value.lng.toFixed(5) : '—'}{'\n'}
                                accuracy: {fix.value?.accuracy != null ? `${Math.round(fix.value.accuracy)} m` : '—'}
                            </Text>
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
