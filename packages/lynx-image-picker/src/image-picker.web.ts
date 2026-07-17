/**
 * Web implementation: routes through the `@sigx/lynx-web-host` page bridge
 * (`sigx.picker.pick` → hidden `<input type=file>`; the input element can't
 * exist in web-core's Worker). Picked assets come back as `blob:` URLs —
 * fetchable from the worker and renderable by `<image>` — with name / size /
 * mime and decoded image dimensions. The browser picker grants per-pick
 * access like the native ones, so the permission methods resolve granted.
 * Swapped in by the plugin's `.web.js` extensionAlias (#697).
 */
import { webHostCall, isWebHostAvailable } from '@sigx/lynx-core';
import type { PermissionResponse } from '@sigx/lynx-core';

import type { ImagePickerAsset, ImagePickerOptions, ImagePickerResult } from './image-picker.js';

export type { ImagePickerAsset, ImagePickerOptions, ImagePickerResult } from './image-picker.js';

/** Shape returned by the host's `sigx.picker.pick` handler. */
interface HostPickedFile {
  uri: string;
  name: string;
  size: number;
  mimeType: string;
  width?: number;
  height?: number;
}

function toResult(files: HostPickedFile[]): ImagePickerResult {
  const assets: ImagePickerAsset[] = files.map((f) => ({
    uri: f.uri,
    width: f.width ?? 0,
    height: f.height ?? 0,
    type: f.mimeType.startsWith('video/') ? 'video' : 'image',
    fileSize: f.size,
    fileName: f.name,
  }));
  return { cancelled: files.length === 0, assets };
}

function acceptFor(mediaType: ImagePickerOptions['mediaType'], fallback: string): string {
  if (mediaType === 'photo') return 'image/*';
  if (mediaType === 'video') return 'video/*';
  if (mediaType === 'mixed') return 'image/*,video/*';
  return fallback;
}

const GRANTED: PermissionResponse = { status: 'granted', canAskAgain: true };

export const ImagePicker: typeof import('./image-picker.js').ImagePicker = {
  async pickImage(options: ImagePickerOptions = {}): Promise<ImagePickerResult> {
    const files = await webHostCall<HostPickedFile[]>('picker.pick', {
      accept: acceptFor(options.mediaType, 'image/*'),
      multiple: options.multiple === true,
    });
    return toResult(files);
  },

  async pickVideo(options: ImagePickerOptions = {}): Promise<ImagePickerResult> {
    const files = await webHostCall<HostPickedFile[]>('picker.pick', {
      accept: 'video/*',
      multiple: options.multiple === true,
    });
    return toResult(files);
  },

  // The browser file dialog needs no upfront permission — mirror the native
  // per-pick-grant pickers by resolving granted.
  requestPermission(): Promise<PermissionResponse> {
    return Promise.resolve(GRANTED);
  },

  getPermissionStatus(): Promise<PermissionResponse> {
    return Promise.resolve(GRANTED);
  },

  isAvailable(): boolean {
    return isWebHostAvailable();
  },
} as const;
