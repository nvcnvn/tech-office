import { z } from 'zod';

/**
 * Password rules, shared by every client.
 *
 * The bounds mirror `iam.MinPasswordLength` / `iam.MaxPasswordLength` in
 * backend/internal/iam/constants.go, which is the authority: the API accepts 8–72
 * characters (72 is bcrypt's limit). The web signup form used to demand 16 while the
 * mobile owner signup asked for 8, so the same product stated two different rules
 * depending on the device, and the stricter one was the first thing a new owner hit.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

export const passwordSchema = z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
    .max(PASSWORD_MAX_LENGTH, `Password must be ${PASSWORD_MAX_LENGTH} characters or less`)
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[a-zA-Z]/, 'Password must contain at least one letter');

/**
 * Password strength levels for UI feedback
 */
export type PasswordStrength = 'weak' | 'medium' | 'strong';

/**
 * Calculate password strength for visual indicator.
 *
 * Strength is advice, not a gate: the minimum above is what the form enforces, and a
 * password that only just clears it is honestly reported as weak.
 *
 * @param password - Password to evaluate
 * @returns Strength level
 */
export function calculatePasswordStrength(password: string): PasswordStrength {
    if (password.length < PASSWORD_MIN_LENGTH) return 'weak';

    const hasNumber = /[0-9]/.test(password);
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasUppercase = /[A-Z]/.test(password);
    const hasSpecial = /[^a-zA-Z0-9]/.test(password);

    const criteriaCount = [
        hasNumber,
        hasLetter,
        hasLowercase,
        hasUppercase,
        hasSpecial,
    ].filter(Boolean).length;

    if (criteriaCount >= 4 && password.length >= 16) return 'strong';
    if (criteriaCount >= 3 && password.length >= 12) return 'medium';
    return 'weak';
}

/**
 * Get detailed password validation feedback for UI
 * @param password - Password to validate
 * @returns Checklist of met/unmet criteria
 */
export function getPasswordValidationDetails(password: string) {
    return {
        minLength: password.length >= PASSWORD_MIN_LENGTH,
        hasNumber: /[0-9]/.test(password),
        hasLetter: /[a-zA-Z]/.test(password),
        hasLowercase: /[a-z]/.test(password),
        hasUppercase: /[A-Z]/.test(password),
        hasSpecial: /[^a-zA-Z0-9]/.test(password),
    };
}
