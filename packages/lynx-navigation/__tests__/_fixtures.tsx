/**
 * Shared route fixtures for tests.
 *
 * Why centralized: each test file augmenting `Register.routes` to a different
 * shape causes TS to fail with TS2717 ("Subsequent property declarations must
 * have the same type"). One canonical definition + one augmentation is
 * sufficient — both `types.test.ts` and `runtime.test.tsx` import from here.
 */
import { component } from '@sigx/lynx';
import { Screen } from '../src/components/Screen';
import { defineRoutes } from '../src/define-routes';
import { useParams } from '../src/hooks/use-params';
import { useSearch } from '../src/hooks/use-search';
import type { StandardSchemaV1 } from '../src/types';

export function fakeSchema<T>(): StandardSchemaV1<T, T> {
    return {
        '~standard': {
            version: 1,
            vendor: 'test',
            types: undefined as unknown as { input: T; output: T },
        },
    };
}

export const Home = component(() => () => <view><text>Home</text></view>);

export const Profile = component(() => {
    const { id } = useParams('profile');
    const { tab } = useSearch('profile');
    return () => (
        <view>
            {/* Single-node text via template literal — `findByText` matches per
                text node, so `<text>id:{id}</text>` would split into two nodes
                ("id:" and the value) and the concatenated assertion would fail. */}
            <text>{`profile-id:${id}`}</text>
            <text>{`profile-tab:${tab}`}</text>
        </view>
    );
});

export const Settings = component(() => () => <view><text>Settings</text></view>);

export const ComposeMessage = component(() => () => (
    <view><text>ComposeMessage</text></view>
));

export const FilterSheet = component(() => () => (
    <Screen snapPoints={[0.4, 0.9]} initialSnapIndex={0}>
        <view><text>FilterSheet</text></view>
    </Screen>
));

export const routes = defineRoutes({
    home: { component: Home },
    profile: {
        params: fakeSchema<{ id: string }>(),
        search: fakeSchema<{ tab: 'posts' | 'about' }>(),
        component: Profile,
        path: '/users/:id',
    },
    settings: { component: Settings },
    composeMessage: {
        params: fakeSchema<{ recipientId: string }>(),
        component: ComposeMessage,
        presentation: 'modal',
    },
    filterSheet: {
        component: FilterSheet,
        presentation: 'sheet',
    },
});

declare module '../src/register.js' {
    interface Register {
        routes: typeof routes;
    }
}
