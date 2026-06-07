import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, Heading, ScrollView, Text } from '@sigx/lynx-daisyui';
import { Haptics } from '@sigx/lynx-haptics';
import { DateTimePicker, type DateTimePickerResult } from '@sigx/lynx-datetime-picker';

const pad = (n: number) => String(n).padStart(2, '0');

const describe = (r: DateTimePickerResult | null): string => {
    if (!r) return '—';
    if (r.cancelled) return 'cancelled';
    return `${r.year}-${pad(r.month!)}-${pad(r.day!)} ${pad(r.hour!)}:${pad(r.minute!)}`;
};

/**
 * Date & time picker — the native platform pickers via
 * @sigx/lynx-datetime-picker (UIDatePicker sheet on iOS,
 * DatePickerDialog/TimePickerDialog on Android).
 */
export const DateTimePickerDemo = component(() => {
    // Boxed so the union `T | null` satisfies signal's `T extends object`
    // overload.
    const last = signal<{ value: DateTimePickerResult | null }>({ value: null });

    const run = async (pick: () => Promise<DateTimePickerResult>) => {
        Haptics.selection();
        last.value = await pick();
    };

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Date & time picker" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Date & time picker</Heading>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Native pickers</Text>
                            <Text class="opacity-60 text-sm">
                                UIDatePicker in a sheet on iOS;
                                DatePickerDialog / TimePickerDialog on Android
                                (datetime chains date → time).
                                Available: {String(DateTimePicker.isModuleAvailable())}.
                            </Text>
                            <Button
                                color="primary"
                                onPress={() => run(() => DateTimePicker.pickDate({
                                    value: last.value?.value,
                                }))}
                            >
                                Pick a date
                            </Button>
                            <Button
                                color="secondary"
                                onPress={() => run(() => DateTimePicker.pickTime({
                                    value: last.value?.value,
                                }))}
                            >
                                Pick a time
                            </Button>
                            <Button
                                color="accent"
                                onPress={() => run(() => DateTimePicker.pickDateTime({
                                    value: last.value?.value,
                                }))}
                            >
                                Pick a date & time
                            </Button>
                            <Text class="font-mono text-sm opacity-70">
                                last: {describe(last.value)}
                            </Text>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Clamped range</Text>
                            <Text class="opacity-60 text-sm">
                                minimumDate / maximumDate restrict the picker
                                to the current calendar year.
                            </Text>
                            <Button
                                variant="outline"
                                onPress={() => run(() => {
                                    const year = new Date().getFullYear();
                                    return DateTimePicker.pickDate({
                                        minimumDate: new Date(year, 0, 1),
                                        maximumDate: new Date(year, 11, 31),
                                    });
                                })}
                            >
                                Pick within this year
                            </Button>
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
