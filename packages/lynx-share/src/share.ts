import { callSync, isModuleAvailable } from '@sigx/lynx-core';

const MODULE = 'Share';

export interface ShareOptions {
    title?: string;
    message?: string;
    url?: string;
}

/**
 * Native share dialog APIs.
 *
 * @example
 * ```ts
 * import { Share } from '@sigx/lynx-share';
 *
 * Share.share({ title: 'Check this out', message: 'Built with sigx-lynx!', url: 'https://sigx.dev' });
 * ```
 */
export const Share = {
    share(options: ShareOptions): void {
        callSync(MODULE, 'share', options);
    },

    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
