/**
 * Keychain storage for the values this app has to read while the phone is locked.
 *
 * `expo-secure-store` defaults to `WHEN_UNLOCKED`, which is unreadable in exactly the
 * situation the call feature is built for: a VoIP push waking a locked, force-quit phone.
 * The token read comes back null, the app boots unauthenticated, the authenticated layout
 * that starts the native call integration never mounts, and the answer the user tapped on
 * the lock screen reaches no listener. CallKit then fails the answer action on its own
 * 30-second timeout — the call sits at "Connecting…" and is dropped — the backend is never
 * told anyone answered, and the call rings out to its own timeout as a missed call.
 *
 * `AFTER_FIRST_UNLOCK` is the weakest level that survives a locked screen: nothing is
 * readable until the user has unlocked the phone at least once since boot, which is the
 * one window this feature genuinely cannot ring in. `THIS_DEVICE_ONLY` keeps a session
 * token out of a backup restored onto a different phone.
 */

import * as SecureStore from "expo-secure-store";

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export function getSecureItem(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key, options);
}

export function deleteSecureItem(key: string): Promise<void> {
  return SecureStore.deleteItemAsync(key, options);
}

/**
 * Writes a value, replacing whatever is stored under the key.
 *
 * The delete is not redundant. Keychain's update path changes the value and leaves
 * `kSecAttrAccessible` alone, so an entry first written under the old default stays
 * unreadable on a locked screen no matter how often it is re-saved. Only replacing the
 * entry moves it. This is also what migrates a phone that was signed in before this
 * module existed, on its next launch.
 */
export async function setSecureItem(key: string, value: string): Promise<void> {
  await SecureStore.deleteItemAsync(key, options);
  await SecureStore.setItemAsync(key, value, options);
}
