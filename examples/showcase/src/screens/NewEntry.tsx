import { component } from '@sigx/lynx';
import { useParams, useScreenOptions } from '@sigx/lynx-navigation';
import { Center, Col, Heading, Text } from '@sigx/lynx-daisyui';

export const NewEntry = component(() => {
    const { tripId } = useParams('newEntry');
    useScreenOptions({ title: 'New entry' });

    return () => (
        <Center flex={1}>
            <Col gap={8} align="center">
                <Heading level={2}>New entry</Heading>
                <Text class="opacity-60">tripId: {tripId}</Text>
            </Col>
        </Center>
    );
});
