import type { Config } from 'tailwindcss';
import LynxPreset from '@lynx-js/tailwind-preset';
import { daisyuiPreset } from '@sigx/lynx-daisyui/preset';

export default {
    content: [
        './src/**/*.{tsx,ts,jsx,js}',
        '../../packages/lynx-daisyui/src/**/*.{tsx,ts}',
    ],
    presets: [LynxPreset, daisyuiPreset],
} satisfies Config;
