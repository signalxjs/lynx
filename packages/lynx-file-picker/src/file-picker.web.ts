/**
 * Web implementation: routes through the `@sigx/lynx-web-host` page bridge
 * (`sigx.picker.pick` → hidden `<input type=file>`). Assets come back as
 * `blob:` URLs (fetchable from the worker for reads/uploads) with the
 * name/mimeType/size contract `@sigx/lynx-http`'s FormData relies on.
 * `copyToCache` is a no-op — blob URLs are already session-stable.
 * Swapped in by the plugin's `.web.js` extensionAlias (#697).
 */
import { webHostCall, isWebHostAvailable } from '@sigx/lynx-core';

import type { FilePickerAsset, FilePickerOptions, FilePickerResult } from './file-picker.js';

export type { FilePickerAsset, FilePickerOptions, FilePickerResult } from './file-picker.js';

/** Shape returned by the host's `sigx.picker.pick` handler. */
interface HostPickedFile {
  uri: string;
  name: string;
  size: number;
  mimeType: string;
}

export const FilePicker: typeof import('./file-picker.js').FilePicker = {
  async pick(options: FilePickerOptions = {}): Promise<FilePickerResult> {
    const types = Array.isArray(options.types)
      ? options.types.filter((t) => typeof t === 'string' && t.length > 0)
      : [];
    const files = await webHostCall<HostPickedFile[]>('picker.pick', {
      accept: types.join(','),
      multiple: options.multiple === true,
    });
    const assets: FilePickerAsset[] = files.map((f) => ({
      uri: f.uri,
      name: f.name || 'file',
      mimeType: f.mimeType || 'application/octet-stream',
      size: Number.isFinite(f.size) && f.size >= 0 ? f.size : 0,
    }));
    return { cancelled: files.length === 0, assets };
  },

  isAvailable(): boolean {
    return isWebHostAvailable();
  },
} as const;
