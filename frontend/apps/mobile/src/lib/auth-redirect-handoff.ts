import { MMKV } from "react-native-mmkv";

const handoffStorage = new MMKV({ id: "tech-office" });

const POST_SIGN_IN_REDIRECT_KEY = "auth.pending_post_sign_in_redirect";
const AUTH_SUBDOMAIN_KEY = "auth.pending_auth_subdomain";
const CANONICAL_LINK_KEY = "auth.pending_canonical_link";

let pendingPostSignInRedirect: string | null = handoffStorage.getString(POST_SIGN_IN_REDIRECT_KEY) ?? null;
let pendingAuthSubdomain: string | null = handoffStorage.getString(AUTH_SUBDOMAIN_KEY) ?? null;
let pendingCanonicalLink: string | null = handoffStorage.getString(CANONICAL_LINK_KEY) ?? null;

function setStoredString(key: string, value: string | null): void {
  if (value) {
    handoffStorage.set(key, value);
    return;
  }
  handoffStorage.delete(key);
}

export function setPendingCanonicalLink(raw: string | null | undefined): void {
  pendingCanonicalLink = raw || null;
  setStoredString(CANONICAL_LINK_KEY, pendingCanonicalLink);
}

export function consumePendingCanonicalLink(): string | null {
  const raw = pendingCanonicalLink ?? handoffStorage.getString(CANONICAL_LINK_KEY) ?? null;
  pendingCanonicalLink = null;
  handoffStorage.delete(CANONICAL_LINK_KEY);
  return raw;
}

export function setPendingPostSignInRedirect(
  redirect: string | null | undefined,
  subdomain?: string | null,
): void {
  pendingPostSignInRedirect = redirect || null;
  setStoredString(POST_SIGN_IN_REDIRECT_KEY, pendingPostSignInRedirect);
  if (subdomain !== undefined) {
    pendingAuthSubdomain = subdomain || null;
    setStoredString(AUTH_SUBDOMAIN_KEY, pendingAuthSubdomain);
  }
}

export function consumePendingPostSignInRedirect(): string | null {
  const redirect = pendingPostSignInRedirect ?? handoffStorage.getString(POST_SIGN_IN_REDIRECT_KEY) ?? null;
  pendingPostSignInRedirect = null;
  handoffStorage.delete(POST_SIGN_IN_REDIRECT_KEY);
  return redirect;
}

export function consumePendingAuthSubdomain(): string | null {
  const subdomain = pendingAuthSubdomain ?? handoffStorage.getString(AUTH_SUBDOMAIN_KEY) ?? null;
  pendingAuthSubdomain = null;
  handoffStorage.delete(AUTH_SUBDOMAIN_KEY);
  return subdomain;
}

export function peekPendingPostSignInRedirect(): string | null {
  return pendingPostSignInRedirect ?? handoffStorage.getString(POST_SIGN_IN_REDIRECT_KEY) ?? null;
}

export function peekPendingAuthSubdomain(): string | null {
  return pendingAuthSubdomain ?? handoffStorage.getString(AUTH_SUBDOMAIN_KEY) ?? null;
}
