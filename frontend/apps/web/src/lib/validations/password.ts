import { z } from 'zod';

/**
 * Password validation schema
 * Enforces minimum length and character composition requirements
 */
export const passwordSchema = z
	.string()
	.min(16, 'Password must be at least 16 characters')
	.regex(/[0-9]/, 'Password must contain at least one number')
	.regex(/[a-zA-Z]/, 'Password must contain at least one letter');

/**
 * Password strength levels for UI feedback
 */
export type PasswordStrength = 'weak' | 'medium' | 'strong';

/**
 * Calculate password strength for visual indicator
 * @param password - Password to evaluate
 * @returns Strength level
 */
export function calculatePasswordStrength(password: string): PasswordStrength {
	if (password.length < 16) return 'weak';

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

	if (criteriaCount >= 4 && password.length >= 20) return 'strong';
	if (criteriaCount >= 3 && password.length >= 16) return 'medium';
	return 'weak';
}

/**
 * Get detailed password validation feedback for UI
 * @param password - Password to validate
 * @returns Checklist of met/unmet criteria
 */
export function getPasswordValidationDetails(password: string) {
	return {
		minLength: password.length >= 16,
		hasNumber: /[0-9]/.test(password),
		hasLetter: /[a-zA-Z]/.test(password),
		hasLowercase: /[a-z]/.test(password),
		hasUppercase: /[A-Z]/.test(password),
		hasSpecial: /[^a-zA-Z0-9]/.test(password),
	};
}
