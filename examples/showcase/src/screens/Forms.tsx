import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import {
    Card,
    Checkbox,
    Col,
    Heading,
    Input,
    Radio,
    Row,
    ScrollView,
    Select,
    Text,
    Textarea,
    Toggle,
} from '@sigx/lynx-daisyui';

/**
 * Forms — the daisyui form controls bound to signals, with the live values
 * echoed below so two-way `model` binding and change events are visible.
 */
export const Forms = component(() => {
    const name = signal('');
    const bio = signal('');
    const role = signal('design');
    const newsletter = signal(false);
    const plan = signal('free');
    const darkPreview = signal(false);

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Forms" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Forms</Heading>

                <Card bordered>
                    <Card.Body>
                        <Col gap={12}>
                            <Text weight="semibold">Text inputs</Text>
                            <Input
                                placeholder="Your name"
                                variant="bordered"
                                model={() => name.value}
                            />
                            <Textarea
                                placeholder="Short bio"
                                rows={3}
                                model={() => bio.value}
                            />
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={12}>
                            <Text weight="semibold">Select</Text>
                            <Select
                                value={role.value}
                                onChange={(value) => { role.value = value; }}
                                options={[
                                    { label: 'Design', value: 'design' },
                                    { label: 'Engineering', value: 'eng' },
                                    { label: 'Product', value: 'product' },
                                ]}
                            />
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={12}>
                            <Text weight="semibold">Choices</Text>
                            <Row align="center" justify="space-between">
                                <Text>Subscribe to newsletter</Text>
                                <Checkbox
                                    checked={newsletter.value}
                                    onChange={(checked) => { newsletter.value = checked; }}
                                />
                            </Row>
                            <Row align="center" justify="space-between">
                                <Text>Dark preview</Text>
                                <Toggle
                                    checked={darkPreview.value}
                                    onChange={(checked) => { darkPreview.value = checked; }}
                                />
                            </Row>
                            <Radio>
                                {(['free', 'pro', 'team'] as const).map((value) => (
                                    <Radio.Item
                                        key={value}
                                        value={value}
                                        label={value}
                                        checked={plan.value === value}
                                        onSelect={(picked) => { plan.value = picked; }}
                                    />
                                ))}
                            </Radio>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Live values</Text>
                            <Text class="font-mono text-sm opacity-70">
                                name: {name.value || '—'}{'\n'}
                                bio: {bio.value || '—'}{'\n'}
                                role: {role.value}{'\n'}
                                newsletter: {String(newsletter.value)}{'\n'}
                                plan: {plan.value}{'\n'}
                                dark preview: {String(darkPreview.value)}
                            </Text>
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
