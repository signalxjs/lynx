import type { Config } from 'tailwindcss';
import LynxPreset from '@lynx-js/tailwind-preset';
import { daisyuiPreset } from '@sigx/lynx-daisyui/preset';

export default {
    content: [
        './src/**/*.{tsx,ts,jsx,js}',
        './node_modules/@sigx/lynx-daisyui/dist/**/*.js',
    ],
    presets: [LynxPreset, daisyuiPreset],
} satisfies Config;
