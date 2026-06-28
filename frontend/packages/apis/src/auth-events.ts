import { clearAuthToken } from "./token";

export type AuthFailureReason = "unauthenticated";

export interface AuthFailureEvent {
  reason: AuthFailureReason;
  message: string;
}

type AuthFailureListener = (
  event: AuthFailureEvent,
) => void | Promise<void>;

const listeners = new Set<AuthFailureListener>();

let inFlightNotification: Promise<void> | null = null;
let lastNotificationKey: string | null = null;
let lastNotificationAt = 0;

export function onAuthFailure(listener: AuthFailureListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function notifyAuthFailure(event: AuthFailureEvent): Promise<void> {
  const notificationKey = `${event.reason}:${event.message}`;
  const now = Date.now();

  if (
    inFlightNotification ||
    (lastNotificationKey === notificationKey && now - lastNotificationAt < 1_500)
  ) {
    return;
  }

  lastNotificationKey = notificationKey;
  lastNotificationAt = now;

  inFlightNotification = (async () => {
    await clearAuthToken();

    await Promise.allSettled(
      Array.from(listeners, (listener) => Promise.resolve(listener(event))),
    );
  })();

  try {
    await inFlightNotification;
  } finally {
    inFlightNotification = null;
  }
}