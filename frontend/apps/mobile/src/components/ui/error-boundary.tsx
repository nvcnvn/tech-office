/**
 * ErrorBoundary — T11.1
 *
 * Per-screen crash catcher with a retry button.
 * Wraps screens to prevent the entire app from crashing on render errors.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <MyScreen />
 *   </ErrorBoundary>
 *
 * Or use the HOC:
 *   export default withErrorBoundary(MyScreen);
 */

import React from "react";
import { View, Text, Pressable } from "react-native";
import { makeStyles } from "@/lib/theme";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional fallback to render instead of default error UI */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log to any crash reporting service here
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback && this.state.error) {
        return this.props.fallback(this.state.error, this.reset);
      }

      return <ErrorFallback error={this.state.error} reset={this.reset} />;
    }

    return this.props.children;
  }
}

/**
 * The default fallback, split out of `render()` because the boundary has to be a
 * class — only a class can implement `getDerivedStateFromError` — and a class
 * cannot read the theme, which is a hook.
 */
function ErrorFallback({ error, reset }: { error: Error | null; reset: () => void }) {
  const styles = useStyles();

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>⚠️</Text>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.message} numberOfLines={3}>
        {error?.message ?? "An unexpected error occurred."}
      </Text>
      <Pressable onPress={reset} style={styles.retryBtn}>
        <Text style={styles.retryText}>Try Again</Text>
      </Pressable>
    </View>
  );
}

/**
 * Higher-order component that wraps a screen component with ErrorBoundary.
 *
 * @example
 * export default withErrorBoundary(function MyScreen() { ... });
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>
): React.ComponentType<P> {
  const Wrapped = (props: P) => (
    <ErrorBoundary>
      <Component {...props} />
    </ErrorBoundary>
  );
  Wrapped.displayName = `WithErrorBoundary(${Component.displayName ?? Component.name})`;
  return Wrapped;
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  emoji: { fontSize: 48 },
  title: { fontSize: 20, fontWeight: "700", color: t.text.primary },
  message: { fontSize: 14, color: t.text.secondary, textAlign: "center", lineHeight: 20 },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: t.primary.main,
    borderRadius: 10,
  },
  retryText: { color: t.primary.contrastText, fontWeight: "600", fontSize: 15 },
}));
