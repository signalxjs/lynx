import { component } from '@sigx/lynx';
import { useNav, useScreenOptions } from '@sigx/lynx-navigation';
import { Button, Center, Col, Heading, Text } from '@sigx/lynx-daisyui';

export const TripsList = component(() => {
    const nav = useNav();
    useScreenOptions({ title: 'Trips' });

    return () => (
        <Center flex={1}>
            <Col gap={12} align="center">
                <Heading level={2}>Trips</Heading>
                <Text class="opacity-60">No trips yet</Text>
                {/* Card route — stays inside the Trips tab. */}
                <Button
                    onTap={() => nav.push('tripDetail', { tripId: 'demo-1' })}
                >
                    Open demo trip
                </Button>
                {/* Modal route — escalates to the root nav and overlays the
                    entire tabs UI (TabBar included). */}
                <Button variant="primary" onTap={() => nav.push('newTrip')}>
                    New trip
                </Button>
            </Col>
        </Center>
    );
});
