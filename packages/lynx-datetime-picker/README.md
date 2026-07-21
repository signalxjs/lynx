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

### Displaying the result

The Lynx JS runtime ships no `Intl` (so no `toLocaleDateString`). `formatDate` covers the common display case without one:

```ts
import { DateTimePicker, formatDate } from '@sigx/lynx-datetime-picker';

const r = await DateTimePicker.pickDateTime();
label = formatDate(r.value, 'YYYY-MM-DD HH:mm');   // '2026-06-07 14:30'
```

## API

| Method | Returns |
|---|---|
| `DateTimePicker.pick(opts?)` | `Promise<DateTimePickerResult>` — `opts.mode` selects the picker |
| `DateTimePicker.pickDate(opts?)` | `pick` with `mode: 'date'` |
| `DateTimePicker.pickTime(opts?)` | `pick` with `mode: 'time'` |
| `DateTimePicker.pickDateTime(opts?)` | `pick` with `mode: 'datetime'` |
| `DateTimePicker.isModuleAvailable()` | `boolean` — whether the native module is wired into the current build |
| `formatDate(date, pattern)` | `string` — token formatting for a picked `Date` (see below) |

### `formatDate(date, pattern)`

Locale-free token formatting in **local time**. A missing or Invalid `Date` returns `''`, so a picker result renders without a null check.

| Token | Meaning | Example |
|---|---|---|
| `YYYY` / `YY` | Year, 4- / 2-digit | `2026` / `26` |
| `MM` / `M` | Month, 1–12, padded / bare | `06` / `6` |
| `DD` / `D` | Day of month, padded / bare | `07` / `7` |
| `HH` / `H` | Hour 0–23, padded / bare | `09` / `9` |
| `hh` / `h` | Hour 1–12, padded / bare | `09` / `9` |
| `mm` / `m` | Minute, padded / bare | `05` / `5` |
| `ss` / `s` | Second, padded / bare | `05` / `5` |
| `A` / `a` | Meridiem | `PM` / `pm` |

Anything else passes through literally; wrap literal text in square brackets to protect it from substitution — `formatDate(d, 'DD [at] HH:mm')` → `07 at 14:30` (unescaped, the `a` in `at` is the meridiem token).

There are deliberately no month or weekday **names**: producing them correctly needs locale data the runtime doesn't have. Ship your own lookup table if you need them.

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
