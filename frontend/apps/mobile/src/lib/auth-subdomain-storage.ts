import { MMKV } from "react-native-mmkv";

const authStorage = new MMKV({ id: "tech-office" });

const LAST_SUBDOMAIN_KEY = "auth.last_subdomain";
const LAST_EMAIL_KEY = "auth.last_email";
const LAST_LOGIN_IDENTIFIER_KEY = "auth.last_login_identifier";

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
