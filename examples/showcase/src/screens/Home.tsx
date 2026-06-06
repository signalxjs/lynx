import { component, signal } from '@sigx/lynx';
import { Screen, useNav, useScreenOptions } from '@sigx/lynx-navigation';
import { Col, Input, Row, Text, useTheme, variantOf } from '@sigx/lynx-daisyui';
import { Haptics } from '@sigx/lynx-haptics';
import { LucideIcon } from '@sigx/lynx-icons-lucide/components';
import { catalog, filterExamples, type FlatExample } from '../catalog.js';

/**
 * Home — the catalog entry point. A search input pinned above a native
 * recycler list:
 *
 *  • query empty → one row per area; tapping pushes the `area` sub view.
 *  • query non-empty → flat filtered list across every example; tapping
 *    pushes the example's screen directly.
 *
 * The search field lives in the body (not a Screen.Header slot): the
 * persistent NavHeader swaps its contents during push/pop transitions,
 * which is the wrong behaviour for a focused text field.
 *
 * The theme toggle in the header-right slot replaces the old drawer's
 * appearance switch.
 */
export const Home = component(() => {
    const nav = useNav();
    const theme = useTheme();
    const query = signal('');
    useScreenOptions({ title: 'Showcase' });

    const openExample = (example: FlatExample) => {
        Haptics.selection();
        // The discriminated Example union ties `params` to the parametric
        // `daisyui` route, so both branches are fully typed.
        if (example.params) nav.push(example.route, example.params);
        else nav.push(example.route);
    };

    return () => {
        const results = filterExamples(query.value);
        const searching = query.value.trim().length > 0;

        return (
            <view class="flex-fill bg-base-100">
                <Screen>
                    <Screen.HeaderRight>
                        <view
                            bindtap={() => {
                                Haptics.selection();
                                theme.toggle();
                            }}
                            class="px-3 py-2"
                            accessibility-element={true}
                            accessibility-label="Toggle dark theme"
                            accessibility-trait="button"
                        >
                            {/* `variant="primary"` resolves to a hex fill via the
                                daisy ThemeProvider — parsed SVG content doesn't
                                inherit host CSS. */}
                            {/* variantOf reads the registry's variant for the
                                active theme — `includes('dark')` would
                                mis-detect synthwave/dracula and custom pairs. */}
                            <LucideIcon
                                name={variantOf(theme.name) === 'dark' ? 'sun' : 'moon'}
                                size={22}
                                variant="primary"
                            />
                        </view>
                    </Screen.HeaderRight>
                </Screen>

                <view class="px-4 pt-3 pb-1">
                    <Input
                        placeholder="Search examples…"
                        variant="bordered"
                        model={() => query.value}
                    />
                </view>

                {/* Native recycler — only visible rows mount. */}
                <list
                    class="flex-1"
                    list-type="single"
                    span-count={1}
                    scroll-orientation="vertical"
                >
                    {searching
                        ? (results.length === 0
                            ? (
                                <list-item key="no-results" item-key="no-results">
                                    <view class="px-4 py-6">
                                        <Text class="opacity-60">
                                            No examples match "{query.value.trim()}"
                                        </Text>
                                    </view>
                                </list-item>
                            )
                            : results.map((example) => (
                                <list-item key={example.id} item-key={example.id}>
                                    <view
                                        class="px-4 py-1"
                                        bindtap={() => openExample(example)}
                                        accessibility-element={true}
                                        accessibility-label={`Open ${example.title}`}
                                        accessibility-trait="button"
                                    >
                                        <Row gap={12} align="center" class="border border-base-300 rounded-xl px-4 py-3">
                                            <LucideIcon name={example.icon.name} size={22} variant="primary" />
                                            <Col gap={2} class="flex-1">
                                                <Text weight="semibold">{example.title}</Text>
                                                <Text class="opacity-60 text-sm">
                                                    {example.areaTitle} · {example.description}
                                                </Text>
                                            </Col>
                                            <LucideIcon name="chevron-right" size={18} variant="neutral" />
                                        </Row>
                                    </view>
                                </list-item>
                            )))
                        : catalog.map((area) => (
                            <list-item key={area.id} item-key={area.id}>
                                <view
                                    class="px-4 py-1"
                                    bindtap={() => {
                                        Haptics.selection();
                                        nav.push('area', { areaId: area.id });
                                    }}
                                    accessibility-element={true}
                                    accessibility-label={`Open ${area.title}`}
                                    accessibility-trait="button"
                                >
                                    <Row gap={12} align="center" class="border border-base-300 rounded-xl px-4 py-4">
                                        <LucideIcon name={area.icon.name} size={24} variant="primary" />
                                        <Col gap={2} class="flex-1">
                                            <Text weight="semibold">{area.title}</Text>
                                            <Text class="opacity-60 text-sm">
                                                {area.examples.length} example{area.examples.length === 1 ? '' : 's'}
                                            </Text>
                                        </Col>
                                        <LucideIcon name="chevron-right" size={18} variant="neutral" />
                                    </Row>
                                </view>
                            </list-item>
                        ))}
                </list>
            </view>
        );
    };
});
