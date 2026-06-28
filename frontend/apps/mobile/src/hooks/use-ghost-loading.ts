import { useCallback, useRef, useState } from "react";

export const ghostLoadingTimings = {
  tabMinimumMs: 500,
  screenMinimumMs: 500,
} as const;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useGhostLoading(load: () => Promise<unknown>, minimumMs = ghostLoadingTimings.tabMinimumMs) {
  const [isGhostLoading, setIsGhostLoading] = useState(false);
  const cycleRef = useRef(0);

  const runGhostLoad = useCallback(async () => {
    const cycleId = cycleRef.current + 1;
    cycleRef.current = cycleId;
    setIsGhostLoading(true);

    try {
      await Promise.allSettled([sleep(minimumMs), load()]);
    } finally {
      if (cycleRef.current === cycleId) {
        setIsGhostLoading(false);
      }
    }
  }, [load, minimumMs]);

  return {
    isGhostLoading,
    runGhostLoad,
  };
}