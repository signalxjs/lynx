import type { Config } from 'tailwindcss';
import LynxPreset from '@lynx-js/tailwind-preset';

// No daisyUI preset: FLIK draws its own board and discs, so a component kit
// would be dead weight in a build CI runs on every PR. Utilities only.
export default {
    content: ['./src/**/*.{tsx,ts,jsx,js}'],
    presets: [LynxPreset],
} satisfies Config;
