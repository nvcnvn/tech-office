/**
 * Device-level app settings.
 *
 * One store, one key per preference, read wherever the preference actually
 * takes effect. Settings used to write keys nothing read, so the toggles were
 * decoration; anything added here must have a consumer.
 */

import { MMKV, useMMKVBoolean } from "react-native-mmkv";

export const appSettingsStorage = new MMKV({ id: "app-settings" });

/** Show live notification banners while the app is in the foreground. */
export const IN_APP_ALERTS_KEY = "notifications_enabled";

export function getInAppAlertsEnabled(): boolean {
  return appSettingsStorage.getBoolean(IN_APP_ALERTS_KEY) ?? true;
}

/** Reactive read of the same preference — re-renders when Settings flips it. */
export function useInAppAlertsEnabled(): boolean {
  const [enabled] = useMMKVBoolean(IN_APP_ALERTS_KEY, appSettingsStorage);
  return enabled ?? true;
}

export function setInAppAlertsEnabled(enabled: boolean): void {
  appSettingsStorage.set(IN_APP_ALERTS_KEY, enabled);
}
