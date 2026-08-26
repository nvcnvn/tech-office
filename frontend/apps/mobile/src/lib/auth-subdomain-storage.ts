import { MMKV } from "react-native-mmkv";

const authStorage = new MMKV({ id: "tech-office" });

const LAST_SUBDOMAIN_KEY = "auth.last_subdomain";
const LAST_EMAIL_KEY = "auth.last_email";
const LAST_LOGIN_IDENTIFIER_KEY = "auth.last_login_identifier";
const LAST_DISPLAY_NAME_KEY = "auth.last_display_name";

export function getRememberedAuthSubdomain(): string {
  return authStorage.getString(LAST_SUBDOMAIN_KEY) ?? "";
}

export function rememberAuthSubdomain(subdomain: string): void {
  const normalizedSubdomain = subdomain.trim().toLowerCase();

  if (!normalizedSubdomain) {
    authStorage.delete(LAST_SUBDOMAIN_KEY);
    return;
  }

  authStorage.set(LAST_SUBDOMAIN_KEY, normalizedSubdomain);
}

export function getRememberedAuthEmail(): string {
  return authStorage.getString(LAST_EMAIL_KEY) ?? "";
}

export function rememberAuthEmail(email: string): void {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail) {
    authStorage.delete(LAST_EMAIL_KEY);
    return;
  }

  authStorage.set(LAST_EMAIL_KEY, normalizedEmail);
}

export function getRememberedAuthLoginIdentifier(): string {
  return authStorage.getString(LAST_LOGIN_IDENTIFIER_KEY) ?? "";
}

export function rememberAuthLoginIdentifier(loginIdentifier: string): void {
  const normalizedLoginIdentifier = loginIdentifier.trim();

  if (!normalizedLoginIdentifier) {
    authStorage.delete(LAST_LOGIN_IDENTIFIER_KEY);
    return;
  }

  authStorage.set(LAST_LOGIN_IDENTIFIER_KEY, normalizedLoginIdentifier);
}

/**
 * The remembered person's display name.
 *
 * This is a convenience cache so the sign-in screen can show who the device belongs to and
 * turn recall into recognition. It is never sent to the server and never identifies anyone —
 * the login identifier is what authenticates.
 */
export function getRememberedAuthDisplayName(): string {
  return authStorage.getString(LAST_DISPLAY_NAME_KEY) ?? "";
}

export function rememberAuthDisplayName(displayName: string): void {
  const normalizedDisplayName = displayName.trim();

  if (!normalizedDisplayName) {
    authStorage.delete(LAST_DISPLAY_NAME_KEY);
    return;
  }

  authStorage.set(LAST_DISPLAY_NAME_KEY, normalizedDisplayName);
}

/**
 * True when the device holds everything the known-device sign-in screen needs.
 *
 * Partial state counts as absent: without all three values the screen cannot show who is
 * signing in or where, so the fresh-device sequence renders instead.
 */
export function hasRememberedAuth(): boolean {
  return Boolean(
    getRememberedAuthSubdomain() &&
      getRememberedAuthLoginIdentifier() &&
      getRememberedAuthDisplayName(),
  );
}

/**
 * Forget the remembered person entirely.
 *
 * Wired to "Not you?" and to sign-out. Clears subdomain, identifier and display name
 * together so the screen can never show one person's name above another's workspace.
 * The email prefill is deliberately kept: it belongs to the email sign-in path, which is
 * the way back in when PIN sign-in is not available.
 */
export function clearRememberedAuth(): void {
  authStorage.delete(LAST_SUBDOMAIN_KEY);
  authStorage.delete(LAST_LOGIN_IDENTIFIER_KEY);
  authStorage.delete(LAST_DISPLAY_NAME_KEY);
}
