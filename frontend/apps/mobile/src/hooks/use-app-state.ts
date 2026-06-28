/**
 * useAppState hook
 *
 * Subscribe to app foreground/background transitions.
 */

import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

export function useAppState(onChange: (state: AppStateStatus) => void) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) =>
      onChangeRef.current(s)
    );
    return () => sub.remove();
  }, []);
}
