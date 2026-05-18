import { component, signal } from '@sigx/lynx';
import { useNav, Screen } from '@sigx/lynx-navigation';
import { Button, Col, Input, NavHeader } from '@sigx/lynx-daisyui';
import { Haptics } from '@sigx/lynx-haptics';
import { addTrip } from '../store/trips.js';

export const NewTrip = component(() => {
    const nav = useNav();
    const name = signal('');

    const save = () => {
        const trimmed = name.value.trim();
        if (!trimmed) return;
        addTrip(trimmed);
        Haptics.notification('success');
        nav.pop();
    };

    return () => (
        <view class="flex-fill bg-base-100">
            <Screen title="New trip" />
            {/* NavHeader inside the modal so it slides up with the sheet. */}
            <NavHeader />
            <Col gap={16} padding={24}>
                <Input placeholder="Trip name" model={() => name.value} />
                <Button variant="primary" onPress={save}>Save</Button>
                <Button variant="ghost" onPress={() => nav.pop()}>Cancel</Button>
            </Col>
        </view>
    );
});
