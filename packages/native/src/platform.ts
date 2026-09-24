import type { KeyValueStorage } from '@kobecuppens/feedback-core';
import { Platform } from 'react-native';
import type { PickImage } from './ui';

/* Optional peer dependencies are loaded lazily inside try/catch: Metro and bundlers
   treat these as optional, so apps without them still build. */

function optionalRequire<T>(load: () => T): T | undefined {
  try {
    return load();
  } catch {
    return undefined;
  }
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
  const mod = optionalRequire(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    () => require('@react-native-async-storage/async-storage') as { default?: KeyValueStorage } & KeyValueStorage,
  );
  const storage = mod?.default ?? mod;
  return storage && typeof storage.getItem === 'function' ? storage : undefined;
}

interface ImagePickerModule {
  launchImageLibraryAsync(options: Record<string, unknown>): Promise<{
    canceled: boolean;
    assets: { uri: string; mimeType?: string | null; fileName?: string | null }[] | null;
  }>;
}

const imagePicker = optionalRequire(
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  () => require('expo-image-picker') as ImagePickerModule,
);

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
