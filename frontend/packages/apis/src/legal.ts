/**
 * Legal surface constants shared by web and mobile (Feature 036).
 *
 * TERMS_VERSION must match `CurrentTermsVersion` in
 * `backend/internal/iam/connect_terms.go`. The backend rejects any other value, so
 * a mismatch here fails signup loudly rather than recording an acceptance of terms
 * nobody is serving.
 *
 * Bump it only when the text people agreed to has actually changed: bumping makes
 * every stored acceptance stale and re-prompts everyone.
 */
export const TERMS_VERSION = '2026-08-27';

/** Public URL of the privacy policy. Reachable without signing in. */
export const PRIVACY_POLICY_PATH = '/privacy';

/** Public URL of the terms of service. Reachable without signing in. */
export const TERMS_PATH = '/terms';

/**
 * Monitored mailbox for abuse reports (FR-013).
 *
 * In-app reporting is the primary route — it reaches the workspace's own owners,
 * who can act immediately. This address exists for the cases in-app reporting
 * cannot cover: a person who has been locked out, somebody outside the workspace,
 * or a complaint about the workspace's own owners.
 */
export const ABUSE_CONTACT_EMAIL = 'abuse@transformar.work';

/** Mailbox for privacy and data-protection enquiries. */
export const PRIVACY_CONTACT_EMAIL = 'privacy@transformar.work';

/**
 * Absolute URLs, for the mobile app, which opens these pages in a browser rather
 * than carrying a second copy of the text that would drift from the web one.
 */
export const MARKETING_SITE_ORIGIN = 'https://transformar.work';

export function privacyPolicyUrl(origin: string = MARKETING_SITE_ORIGIN): string {
	return `${origin}${PRIVACY_POLICY_PATH}`;
}

export function termsUrl(origin: string = MARKETING_SITE_ORIGIN): string {
	return `${origin}${TERMS_PATH}`;
}
