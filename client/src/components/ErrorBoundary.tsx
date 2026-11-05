import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/** Shows a friendly screen instead of a blank page if rendering throws. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen grid place-items-center px-6">
        <div
          role="alert"
          className="max-w-md w-full bg-white/5 border border-white/10 rounded-2xl p-8 text-center"
        >
          <h1 className="text-2xl font-display font-semibold text-fog">Something went wrong</h1>
          <p className="mt-3 text-fog/70">
            The page hit an unexpected error. Your synced changes are safe on the server.
          </p>
          <button
            type="button"
            className="mt-6 h-11 px-6 rounded-lg bg-neon text-ink font-semibold hover:brightness-110 transition"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
