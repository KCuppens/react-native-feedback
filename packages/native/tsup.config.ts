import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2020',
  jsx: 'automatic',
  external: [
    'react',
    'react-native',
    '@kobecuppens/feedback-core',
    '@tanstack/react-query',
    '@react-native-async-storage/async-storage',
    'expo-image-picker',
  ],
});
