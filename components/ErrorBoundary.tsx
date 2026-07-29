import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import * as Sentry from '@sentry/react';

interface Props { children?: React.ReactNode; }
interface State { error: Error | null; }

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ZHL] Uncaught render error:', error, info.componentStack);
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <AlertTriangle size={36} className="text-red-400" />
        <div>
          <p className="text-sm font-semibold text-white mb-1">Something went wrong</p>
          <p className="text-xs text-surface-container/70 max-w-sm">{this.state.error.message}</p>
        </div>
        <button
          onClick={() => this.setState({ error: null })}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-white text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer"
        >
          <RefreshCw size={13} /> Try again
        </button>
      </div>
    );
  }
}
