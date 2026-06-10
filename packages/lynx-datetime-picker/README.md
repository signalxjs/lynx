# @sigx/lynx-datetime-picker

Native date/time picker for sigx-lynx — `UIDatePicker` presented in a sheet on iOS, `DatePickerDialog` / `TimePickerDialog` on Android.

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/datetime-picker/overview/](https://sigx.dev/lynx/modules/datetime-picker/overview/)**

- **iOS**: `UIDatePicker` (`.wheels`) in a presented sheet with Cancel/Done.
- **Android**: platform `android.app.DatePickerDialog` / `TimePickerDialog` — no Material or AndroidX dependency. `'datetime'` mode chains the date dialog into the time dialog.

## Install

```bash
pnpm add @sigx/lynx-datetime-picker
```

`sigx prebuild` auto-discovers the package and links the native module. No permissions or usage descriptions are required on either platform.

## Usage

```ts
import { DateTimePicker } from '@sigx/lynx-datetime-picker';

const result = await DateTimePicker.pickDate({
    value: current,                       // initial selection (defaults to now)
    minimumDate: new Date(2020, 0, 1),
    maximumDate: new Date(2030, 11, 31),
});

if (!result.cancelled) {
    current = result.value;               // a JS Date
    // convenience components (local time, month is 1-12):
    // result.year, result.month, result.day, result.hour, result.minute
}
```

`DateTimePicker.pick` **always resolves** — dismissal (and any bridge failure) comes back as `{ cancelled: true }`, so you don't need a try/catch.

## API

| Method | Returns |
|---|---|
| `DateTimePicker.pick(opts?)` | `Promise<DateTimePickerResult>` — `opts.mode` selects the picker |
| `DateTimePicker.pickDate(opts?)` | `pick` with `mode: 'date'` |
| `DateTimePicker.pickTime(opts?)` | `pick` with `mode: 'time'` |
| `DateTimePicker.pickDateTime(opts?)` | `pick` with `mode: 'datetime'` |
| `DateTimePicker.isModuleAvailable()` | `boolean` — whether the native module is wired into the current build |

### `DateTimePickerOptions`

| Option | Type | Notes |
|---|---|---|
| `mode` | `'date' \| 'time' \| 'datetime'` | Defaults to `'date'`. |
| `value` | `Date` | Initial selection. Defaults to now. |
| `minimumDate` | `Date` | Earliest selectable instant. Ignored in `'time'` mode. |
| `maximumDate` | `Date` | Latest selectable instant. Ignored in `'time'` mode. |
| `minuteInterval` | `number` | **iOS only** — `UIDatePicker.minuteInterval` (must evenly divide 60). Round the result yourself if you need it on Android. |
| `is24Hour` | `boolean` | 24-hour clock for time selection. Defaults to the device setting. |
| `title` | `string` | Sheet title (iOS). |

### `DateTimePickerResult`

| Field | Type | Notes |
|---|---|---|
| `cancelled` | `boolean` | True when dismissed without choosing. |
| `value` | `Date?` | Selected instant. Absent when cancelled. |
| `year` / `month` / `day` | `number?` | Local components of `value`; `month` is **1–12** (unlike `Date#getMonth`). |
| `hour` / `minute` | `number?` | Local time-of-day components of `value`. |

### Platform notes

**Values cross the bridge as epoch milliseconds.** The JS surface accepts and returns `Date`; the native side never parses date strings, so there is no timezone/format ambiguity.

**`'time'` mode still returns a full `Date`** — anchored to the initial `value`'s day (or today). Use `result.hour` / `result.minute` when you only care about the time of day.

**Android `'datetime'`** is a two-step flow (date dialog, then time dialog); cancelling either step cancels the whole pick. iOS shows a single combined wheel picker.

## Reference

The showcase app's "Date & time picker" screen (`examples/showcase/src/screens/DateTimePickerDemo.tsx`) demonstrates all three modes plus min/max clamping.
