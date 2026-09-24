import { useFeedbackContext } from '@kobecuppens/feedback-core/react';
import { Component, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useUI } from './ui';

interface Props {
  fallback: (retry: () => void) => ReactNode;
  onError: (error: unknown) => void;
  children: ReactNode;
}

class Boundary extends Component<Props, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    // A throwing analytics handler must not escape the boundary it reports from.
    try {
      this.props.onError(error);
    } catch (reportError) {
      console.error(reportError);
    }
  }

  render() {
    if (this.state.error) return this.props.fallback(() => this.setState({ error: null }));
    return this.props.children;
  }
}

/**
 * Keeps a render error inside the board (bad data from a custom adapter, a broken
 * component override) from unmounting the host app's screen. Reports via onEvent.
 */
export function FeedbackErrorBoundary({ children }: { children: ReactNode }) {
  const { onEvent } = useFeedbackContext();
  const { styles, strings } = useUI();
  // Plain elements only: the crash may come from an EmptyState or Button override.
  // Render crashes are usually TypeErrors too, so never present them as a network problem.
  const fallback = (retry: () => void) => (
    <View style={styles.empty} accessibilityRole="alert">
      <Text style={styles.emptyText}>{strings.errors.generic}</Text>
      <Pressable accessibilityRole="button" onPress={retry} style={styles.buttonSecondary}>
        <Text style={styles.buttonSecondaryText}>{strings.errors.retry}</Text>
      </Pressable>
    </View>
  );
  return (
    <Boundary fallback={fallback} onError={(error) => onEvent({ type: 'error', error })}>
      {children}
    </Boundary>
  );
}
