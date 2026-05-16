import { component } from '@sigx/lynx';
import { useScreenOptions } from '@sigx/lynx-navigation';
import { Center, Col, Heading, Text } from '@sigx/lynx-daisyui';

export const NewTrip = component(() => {
    useScreenOptions({ title: 'New trip' });

    return () => (
        <Center flex={1}>
            <Col gap={8} align="center">
                <Heading level={2}>New trip</Heading>
                <Text class="opacity-60">Form coming in step 3</Text>
            </Col>
        </Center>
    );
});
