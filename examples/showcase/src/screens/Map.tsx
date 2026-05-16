import { component } from '@sigx/lynx';
import { Center, Col, Heading, Text } from '@sigx/lynx-daisyui';

export const Map = component(() => () => (
    <Center flex={1}>
        <Col gap={8} align="center">
            <Heading level={2}>Map</Heading>
            <Text class="opacity-60">Entries by location — coming soon</Text>
        </Col>
    </Center>
));
