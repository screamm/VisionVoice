'use client';

import { Component, ErrorInfo, ReactNode } from 'react';
import { ErrorCategory, ErrorSeverity, logError, AppError } from '@/types/errors';

/**
 * Props for ErrorBoundary component
 */
interface ErrorBoundaryProps {
  children: ReactNode;
  /** Custom fallback UI to render when error occurs */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  /** Callback when error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Whether to show reset button */
  showReset?: boolean;
}

/**
 * State for ErrorBoundary component
 */
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * React Error Boundary Component
 *
 * Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a fallback UI.
 *
 * @example
 * ```tsx
 * <ErrorBoundary
 *   fallback={(error, reset) => (
 *     <div>
 *       <p>Something went wrong: {error.message}</p>
 *       <button onClick={reset}>Try Again</button>
 *     </div>
 *   )}
 *   onError={(error) => logToService(error)}
 * >
 *   <App />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error with context
    logError('ErrorBoundary', error, {
      componentStack: errorInfo.componentStack
    });

    // Update state with error info
    this.setState({ errorInfo });

    // Call optional error callback
    this.props.onError?.(error, errorInfo);
  }

  /**
   * Reset the error boundary state
   */
  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  render(): ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback, showReset = true } = this.props;

    if (hasError && error) {
      // Custom fallback renderer
      if (typeof fallback === 'function') {
        return fallback(error, this.handleReset);
      }

      // Custom fallback element
      if (fallback) {
        return fallback;
      }

      // Default fallback UI
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="error-boundary-fallback"
        >
          <div className="error-boundary-content">
            <div className="error-boundary-icon" aria-hidden="true">
              &#9888;
            </div>
            <h2 className="error-boundary-title">Something went wrong</h2>
            <p className="error-boundary-message">
              {error.message || 'An unexpected error occurred'}
            </p>
            {showReset && (
              <button
                onClick={this.handleReset}
                className="error-boundary-button"
                type="button"
              >
                Try Again
              </button>
            )}
            <button
              onClick={() => window.location.reload()}
              className="error-boundary-button error-boundary-button-secondary"
              type="button"
            >
              Reload Page
            </button>
          </div>

          <style jsx>{`
            .error-boundary-fallback {
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              padding: 20px;
              background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
              color: white;
            }

            .error-boundary-content {
              text-align: center;
              max-width: 400px;
              padding: 32px;
              background: rgba(255, 255, 255, 0.05);
              border-radius: 16px;
              backdrop-filter: blur(10px);
              border: 1px solid rgba(255, 255, 255, 0.1);
            }

            .error-boundary-icon {
              font-size: 64px;
              margin-bottom: 16px;
              color: #fbbf24;
            }

            .error-boundary-title {
              font-size: 24px;
              font-weight: 600;
              margin: 0 0 12px 0;
            }

            .error-boundary-message {
              font-size: 16px;
              color: rgba(255, 255, 255, 0.7);
              margin: 0 0 24px 0;
              line-height: 1.5;
            }

            .error-boundary-button {
              display: block;
              width: 100%;
              padding: 14px 24px;
              font-size: 16px;
              font-weight: 600;
              color: white;
              background: #3b82f6;
              border: none;
              border-radius: 8px;
              cursor: pointer;
              transition: all 0.2s;
              margin-bottom: 12px;
            }

            .error-boundary-button:hover {
              background: #2563eb;
              transform: translateY(-1px);
            }

            .error-boundary-button:active {
              transform: translateY(0);
            }

            .error-boundary-button-secondary {
              background: transparent;
              border: 1px solid rgba(255, 255, 255, 0.3);
            }

            .error-boundary-button-secondary:hover {
              background: rgba(255, 255, 255, 0.1);
              border-color: rgba(255, 255, 255, 0.5);
            }
          `}</style>
        </div>
      );
    }

    return children;
  }
}

/**
 * Hook-friendly error boundary wrapper for async errors
 * Use this in functional components to report errors to the nearest ErrorBoundary
 */
export function useErrorHandler(): (error: Error) => void {
  return (error: Error) => {
    // Re-throw to let ErrorBoundary catch it
    throw error;
  };
}

/**
 * Higher-order component for wrapping components with error boundary
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  fallback?: ErrorBoundaryProps['fallback']
): React.FC<P> {
  const WithErrorBoundary: React.FC<P> = (props) => (
    <ErrorBoundary fallback={fallback}>
      <WrappedComponent {...props} />
    </ErrorBoundary>
  );

  WithErrorBoundary.displayName = `WithErrorBoundary(${WrappedComponent.displayName || WrappedComponent.name || 'Component'})`;

  return WithErrorBoundary;
}
