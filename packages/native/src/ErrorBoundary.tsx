import { useFeedbackContext } from '@kobecuppens/feedback-core/react';
import { Component, type ReactNode } from 'react';
import { ErrorState } from './components';

interface Props {
  message: string;
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
    // Render crashes are usually TypeErrors too: never present them as a network problem.
    if (this.state.error) {
      return <ErrorState error={this.state.error} message={this.props.message} onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}

/**
 * Keeps a render error inside the board (bad data from a custom adapter, a broken
 * component override) from unmounting the host app's screen. Reports via onEvent.
 */
export function FeedbackErrorBoundary({ children }: { children: ReactNode }) {
  const { onEvent, strings } = useFeedbackContext();
  return (
    <Boundary message={strings.errors.generic} onError={(error) => onEvent({ type: 'error', error })}>
      {children}
    </Boundary>
  );
}
