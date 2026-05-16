import { component } from '@sigx/lynx';
import { useNav, useParams, useScreenOptions } from '@sigx/lynx-navigation';
import { Button, Center, Col, Heading, Text } from '@sigx/lynx-daisyui';

export const TripDetail = component(() => {
    const nav = useNav();
    const { tripId } = useParams('tripDetail');
    useScreenOptions({ title: 'Trip' });

    return () => (
        <Center flex={1}>
            <Col gap={12} align="center">
                <Heading level={2}>Trip detail</Heading>
                <Text class="opacity-60">tripId: {tripId}</Text>
                {/* Modal — escalates to root, covers the whole tabs UI. */}
                <Button
                    variant="primary"
                    onTap={() => nav.push('newEntry', { tripId })}
                >
                    Add entry
                </Button>
            </Col>
        </Center>
    );
});
