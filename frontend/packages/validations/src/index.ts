/**
 * @tech-office/validations
 * Shared validation schemas and utilities for web and mobile apps
 */

// Email validation
export { emailSchema, extractEmailDomain } from './email';

// Password validation
export {
    passwordSchema,
    PASSWORD_MIN_LENGTH,
    PASSWORD_MAX_LENGTH,
    calculatePasswordStrength,
    getPasswordValidationDetails,
    type PasswordStrength,
} from './password';

// Subdomain validation
export {
    subdomainSchema,
    sanitizeSubdomain,
    isValidSubdomainFormat,
    generateSubdomainSuggestions,
} from './subdomain';

// Project key validation
export {
    PROJECT_KEY_PATTERN,
    PROJECT_KEY_RULE_TEXT,
    projectKeySchema,
    deriveProjectKey,
} from './project-key';

// Signup form validation
export { signupFormSchema, validateSignupForm, type SignupFormData } from './signup';
