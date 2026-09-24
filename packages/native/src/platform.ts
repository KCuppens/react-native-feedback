import type { KeyValueStorage } from '@kobecuppens/feedback-core';
import { Platform } from 'react-native';
import type { PickImage } from './ui';

/* Optional peer dependencies. Each require() must sit lexically inside its own
   try/catch: that is what Metro (and webpack) treat as an optional dependency, so apps
   without the package still bundle. Wrapping the require in a helper function breaks it. */

let asyncStorageModule: ({ default?: KeyValueStorage } & KeyValueStorage) | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  asyncStorageModule = require('@react-native-async-storage/async-storage');
} catch {
  asyncStorageModule = undefined;
}

/** AsyncStorage on native, localStorage on web, memory otherwise (anonymous id only). */
export function defaultStorage(): KeyValueStorage | undefined {
  if (Platform.OS === 'web') {
    try {
      const ls = globalThis.localStorage;
      if (ls) return { getItem: (k) => ls.getItem(k), setItem: (k, v) => ls.setItem(k, v) };
    } catch {
      // Private mode / blocked storage: fall through to memory.
    }
    return undefined;
  }
  const storage = asyncStorageModule?.default ?? asyncStorageModule;
  return storage && typeof storage.getItem === 'function' ? storage : undefined;
}

interface ImagePickerModule {
  launchImageLibraryAsync(options: Record<string, unknown>): Promise<{
    canceled: boolean;
    assets: { uri: string; mimeType?: string | null; fileName?: string | null }[] | null;
  }>;
}

let imagePicker: ImagePickerModule | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  imagePicker = require('expo-image-picker');
} catch {
  imagePicker = undefined;
}

/** Uses expo-image-picker when installed; undefined otherwise (pass `pickImage` yourself). */
export const defaultPickImage: PickImage | undefined = imagePicker?.launchImageLibraryAsync
  ? async () => {
      const result = await imagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: false });
      const asset = result.assets?.[0];
      if (result.canceled || !asset) return null;
      const type = asset.mimeType ?? 'image/jpeg';
      const name = asset.fileName ?? `screenshot.${type.split('/')[1] ?? 'jpg'}`;
      if (Platform.OS === 'web') {
        // On web the picker returns a blob/data URI; FormData needs a real Blob.
        const blob = await (await fetch(asset.uri)).blob();
        return { file: new File([blob], name, { type }), previewUri: asset.uri };
      }
      return { file: { uri: asset.uri, name, type }, previewUri: asset.uri };
    }
  : undefined;
