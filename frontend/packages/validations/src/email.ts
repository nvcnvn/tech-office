import { z } from 'zod';

/**
 * Email validation schema
 * Enforces valid email format and maximum length
 */
export const emailSchema = z
    .string()
    .email('Please enter a valid email address')
    .max(255, 'Email must be 255 characters or less');

/**
 * Extract domain from email address
 * @param email - Email address
 * @returns Domain portion (e.g., "example.com" from "user@example.com")
 */
export function extractEmailDomain(email: string): string | null {
    const match = email.match(/@(.+)$/);
    return match ? match[1] : null;
}
