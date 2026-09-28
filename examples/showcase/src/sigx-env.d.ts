// Types `env` from `@sigx/lynx` from this app's signalx.config.ts (#1244).
import type config from '../signalx.config';
import type { EnvOf } from '@sigx/lynx-cli/config';

declare global {
    interface SigxAppEnv extends EnvOf<typeof config> {}
}

export {};
