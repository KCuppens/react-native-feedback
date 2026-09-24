import {
  createMemoryAdapter,
  FeedbackBoard,
  type FeedbackComponents,
  type FeedbackStyles,
  type FeedbackThemeInput,
} from '@kobecuppens/react-native-feedback';
import { useMemo, useState } from 'react';
import { Pressable, StatusBar, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

/*
 * Runs offline against the in-memory adapter by default. To use the real API:
 *   EXPO_PUBLIC_FEEDBACK_KEY=pk_... EXPO_PUBLIC_FEEDBACK_URL=http://localhost:8787 npx expo start
 * In a real app, fetch `userToken` from your server (signFeedbackUser) instead of hardcoding it.
 */
const projectKey = process.env.EXPO_PUBLIC_FEEDBACK_KEY;
const baseUrl = process.env.EXPO_PUBLIC_FEEDBACK_URL;
const userToken = process.env.EXPO_PUBLIC_FEEDBACK_USER_TOKEN ?? null;

// Two "brands" to show the same board styled for different apps.
const brands: Record<string, { theme: FeedbackThemeInput | { light: FeedbackThemeInput; dark: FeedbackThemeInput }; styles?: FeedbackStyles; components?: FeedbackComponents }> = {
  default: { theme: {} },
  cream: {
    // 1% Better-style: warm cream canvas, serif headings, soft cards.
    theme: {
      light: {
        colors: { background: '#F7F4EF', surface: '#FFFDF9', surfaceAlt: '#EFE9DF', primary: '#1F3D2B', onPrimary: '#F7F4EF', upvote: '#1F3D2B', border: '#E6DED1' },
        radii: { md: 14, lg: 20 },
        fonts: { heading: 'Georgia' },
      },
      dark: {
        colors: { background: '#15130F', surface: '#1E1B16', surfaceAlt: '#29251E', primary: '#C9E4C5', onPrimary: '#15130F', border: '#332E26' },
      },
    },
    styles: { cardTitle: { letterSpacing: 0.2 }, fab: { borderRadius: 14 } },
  },
  neon: {
    theme: {
      colorScheme: 'dark',
      colors: { background: '#05050A', surface: '#0F0F1A', surfaceAlt: '#1A1A2E', primary: '#00F5D4', onPrimary: '#05050A', text: '#EDEDF7', border: '#26263D' },
      radii: { sm: 2, md: 4, lg: 6 },
    },
    styles: { card: { borderWidth: 1, borderColor: '#00F5D455' } },
  },
};

export default function App() {
  const [brand, setBrand] = useState<keyof typeof brands>('default');
  const adapter = useMemo(
    () =>
      projectKey
        ? undefined
        : createMemoryAdapter({
            latency: 250,
            settings: { inAppAdmin: true },
            viewer: { id: 'me', name: 'Demo user', isAdmin: true },
            categories: [
              { id: 'feature', name: 'Feature', color: '#2563EB', sort: 0 },
              { id: 'bug', name: 'Bug', color: '#DC2626', sort: 1 },
            ],
            posts: [
              { title: 'Dark mode for widgets', body: 'The home-screen widget ignores dark mode.', score: 42, upvotes: 44, downvotes: 2, status: 'planned' },
              { title: 'Export my data as CSV', score: 17, upvotes: 17, status: 'in_progress' },
              { title: 'Apple Watch app', score: 9, upvotes: 10, downvotes: 1 },
              { title: 'Crash when rotating on iPad', score: 5, upvotes: 5, status: 'done', category: { id: 'bug', name: 'Bug', color: '#DC2626', sort: 1 } },
              { title: 'Someone else’s pending idea', moderation: 'pending' },
            ],
          }),
    [],
  );

  const { theme, styles, components } = brands[brand]!;
  return (
    <SafeAreaProvider>
    <SafeAreaView style={{ flex: 1 }}>
      <StatusBar />
      <FeedbackBoard
        key={brand}
        adapter={adapter}
        projectKey={projectKey}
        baseUrl={baseUrl}
        userToken={userToken}
        theme={theme}
        styles={styles}
        components={components}
        onEvent={(e) => e.type === 'error' && console.warn('feedback error', e.error)}
        headerAccessory={
          <View style={{ flexDirection: 'row', gap: 8, padding: 12 }}>
            {Object.keys(brands).map((b) => (
              <Pressable key={b} onPress={() => setBrand(b)} style={{ padding: 6, opacity: b === brand ? 1 : 0.5 }}>
                <Text>{b}</Text>
              </Pressable>
            ))}
          </View>
        }
      />
    </SafeAreaView>
    </SafeAreaProvider>
  );
}
