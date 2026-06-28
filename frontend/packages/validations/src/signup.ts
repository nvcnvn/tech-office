import { z } from 'zod';
import { passwordSchema } from './password';
import { emailSchema } from './email';
import { subdomainSchema } from './subdomain';

/**
 * Complete signup form validation schema
 * Combines all field validations for the organization registration form
 */
export const signupFormSchema = z.object({
    companyName: z
        .string()
        .min(1, 'Company name is required')
        .max(255, 'Company name must be 255 characters or less'),
    subdomain: subdomainSchema,
    adminEmail: emailSchema,
    adminPassword: passwordSchema,
    adminGivenName: z
        .string()
        .min(1, 'First name is required')
        .max(100, 'First name must be 100 characters or less'),
    adminFamilyName: z
        .string()
        .min(1, 'Last name is required')
        .max(100, 'Last name must be 100 characters or less'),
});

/**
 * TypeScript type inferred from signup form schema
 */
export type SignupFormData = z.infer<typeof signupFormSchema>;

/**
 * Validate complete signup form data
 * @param data - Form data to validate
 * @returns Validation result with parsed data or errors
 */
export function validateSignupForm(data: unknown) {
    return signupFormSchema.safeParse(data);
}
