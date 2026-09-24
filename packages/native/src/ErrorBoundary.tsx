import { useFeedbackContext } from '@kobecuppens/feedback-core/react';
import { Component, type ReactNode } from 'react';
import { ErrorState } from './components';

interface Props {
  onError: (error: unknown) => void;
  children: ReactNode;
}

class Boundary extends Component<Props, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }

  render() {
    if (this.state.error) return <ErrorState error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}

/**
 * Keeps a render error inside the board (bad data from a custom adapter, a broken
 * component override) from unmounting the host app's screen. Reports via onEvent.
 */
export function FeedbackErrorBoundary({ children }: { children: ReactNode }) {
  const { onEvent } = useFeedbackContext();
  return <Boundary onError={(error) => onEvent({ type: 'error', error })}>{children}</Boundary>;
}
