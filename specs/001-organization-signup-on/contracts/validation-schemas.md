# Validation Schemas: Organization SignUp

**Feature**: Organization SignUp on Web  
**Date**: October 25, 2025  
**Status**: Design Complete

## Overview

This document defines all frontend validation schemas using **Zod** for type-safe form validation. These schemas enforce business rules from the feature specification and provide clear, user-friendly error messages.

---

## Dependencies

```typescript
import { z } from 'zod';
```

**Installation**: Already covered in research.md
```bash
cd frontend && pnpm add zod @hookform/resolvers -w
```

---

## Schema Definitions

### 1. Password Schema

**Location**: `frontend/apps/web/src/lib/validations/password.ts`

**Requirements** (from FR-005):
- Minimum 16 characters length
- Must contain at least one number
- Must contain at least one alphabetic character

```typescript
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
```

**Usage Example**:
```typescript
const result = passwordSchema.safeParse('short');
if (!result.success) {
  console.error(result.error.errors[0].message);
  // "Password must be at least 16 characters"
}
```

---

### 2. Email Schema

**Location**: `frontend/apps/web/src/lib/validations/email.ts`

**Requirements** (from FR-004):
- Valid email format
- Maximum 255 characters (database constraint)

```typescript
import { z } from 'zod';

/**
 * Email validation schema
 * Enforces valid email format and length constraints
 */
export const emailSchema = z
  .string()
  .min(1, 'Email is required')
  .email('Please enter a valid email address')
  .max(255, 'Email address is too long (max 255 characters)');

/**
 * Extract domain from email for display purposes
 * @param email - Email address
 * @returns Domain portion or empty string if invalid
 */
export function extractEmailDomain(email: string): string {
  const match = email.match(/@(.+)$/);
  return match ? match[1] : '';
}
```

**Usage Example**:
```typescript
const result = emailSchema.safeParse('admin@acme.com');
if (result.success) {
  console.log('Valid email:', result.data);
}
```

---

### 3. Subdomain Schema

**Location**: `frontend/apps/web/src/lib/validations/subdomain.ts`

**Requirements** (from FR-006):
- DNS-compliant format
- Alphanumeric characters and hyphens only
- Must start and end with alphanumeric character (not hyphen)
- Maximum 32 characters
- Minimum 3 characters (usability)
- Lowercase only (normalized)

```typescript
import { z } from 'zod';

/**
 * Subdomain validation schema
 * Enforces DNS-compliant subdomain format
 */
export const subdomainSchema = z
  .string()
  .min(3, 'Subdomain must be at least 3 characters')
  .max(32, 'Subdomain must be 32 characters or less')
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
    'Subdomain must start and end with a letter or number, and can only contain lowercase letters, numbers, and hyphens'
  )
  .transform((val) => val.toLowerCase()); // Normalize to lowercase

/**
 * Sanitize user input for subdomain field
 * Converts to lowercase and removes invalid characters
 * @param input - Raw user input
 * @returns Sanitized subdomain string
 */
export function sanitizeSubdomain(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '') // Remove invalid chars
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

/**
 * Validate subdomain format without throwing
 * @param subdomain - Subdomain to check
 * @returns true if valid format, false otherwise
 */
export function isValidSubdomainFormat(subdomain: string): boolean {
  const result = subdomainSchema.safeParse(subdomain);
  return result.success;
}

/**
 * Generate suggested subdomains from company name
 * @param companyName - Organization name
 * @returns Array of suggested subdomain variants
 */
export function generateSubdomainSuggestions(companyName: string): string[] {
  const base = sanitizeSubdomain(companyName);
  const suggestions: string[] = [];
  
  if (base.length >= 3) suggestions.push(base);
  if (base.length <= 29) suggestions.push(`${base}hq`);
  if (base.length <= 27) suggestions.push(`${base}corp`);
  
  return suggestions.filter((s) => isValidSubdomainFormat(s)).slice(0, 3);
}
```

**Usage Example**:
```typescript
const input = 'Acme Corp!';
const sanitized = sanitizeSubdomain(input); // 'acmecorp'
const result = subdomainSchema.safeParse(sanitized);
if (result.success) {
  console.log('Valid subdomain:', result.data);
}
```

---

### 4. Full Signup Form Schema

**Location**: `frontend/apps/web/src/lib/validations/signup.ts`

**Combines all field schemas into a single form schema**

```typescript
import { z } from 'zod';
import { emailSchema } from './email';
import { passwordSchema } from './password';
import { subdomainSchema } from './subdomain';

/**
 * Complete signup form validation schema
 * Used with React Hook Form for end-to-end type safety
 */
export const signupFormSchema = z.object({
  // Organization fields
  companyName: z
    .string()
    .min(1, 'Company name is required')
    .max(255, 'Company name is too long (max 255 characters)')
    .trim(),

  subdomain: subdomainSchema,

  // Admin user fields
  adminEmail: emailSchema,

  adminPassword: passwordSchema,

  adminGivenName: z
    .string()
    .min(1, 'First name is required')
    .max(100, 'First name is too long (max 100 characters)')
    .trim(),

  adminFamilyName: z
    .string()
    .min(1, 'Last name is required')
    .max(100, 'Last name is too long (max 100 characters)')
    .trim(),
});

/**
 * TypeScript type inferred from schema
 * Use this type for form state and API calls
 */
export type SignupFormData = z.infer<typeof signupFormSchema>;

/**
 * Validate entire form and return structured errors
 * @param data - Form data to validate
 * @returns Validation result with typed errors
 */
export function validateSignupForm(data: unknown) {
  return signupFormSchema.safeParse(data);
}
```

**Type Inference**:
```typescript
// SignupFormData will be:
{
  companyName: string;
  subdomain: string;
  adminEmail: string;
  adminPassword: string;
  adminGivenName: string;
  adminFamilyName: string;
}
```

---

## Error Message Standards

### User-Friendly Messages

All error messages follow these principles:
1. **Clear**: Explain what went wrong
2. **Actionable**: Tell user how to fix it
3. **Concise**: < 80 characters when possible
4. **Friendly**: Avoid technical jargon

### Error Message Patterns

| Validation | Error Message | Reason |
|------------|---------------|--------|
| Empty field | `{Field name} is required` | Missing required input |
| Too short | `{Field} must be at least {N} characters` | Minimum length not met |
| Too long | `{Field} is too long (max {N} characters)` | Maximum length exceeded |
| Invalid format | `{Field} must {specific rule}` | Format constraint violated |
| Already exists | `This {field} is already registered` | Uniqueness constraint (from backend) |

---

## React Hook Form Integration

### Setup in Component

```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { signupFormSchema, SignupFormData } from '@/lib/validations/signup';

function SignupForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<SignupFormData>({
    resolver: zodResolver(signupFormSchema),
    mode: 'onBlur', // Validate on field blur for better UX
  });

  const onSubmit = async (data: SignupFormData) => {
    try {
      await registerOrganizationWithAdminPassword(data);
      // Success handling
    } catch (err) {
      // Error handling with setError()
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <TextField
        {...register('companyName')}
        error={!!errors.companyName}
        helperText={errors.companyName?.message}
      />
      {/* Other fields */}
    </form>
  );
}
```

---

## Testing Validation Schemas

### Unit Tests (Post-Implementation)

**Test File**: `frontend/apps/web/src/lib/validations/__tests__/signup.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { 
  passwordSchema, 
  emailSchema, 
  subdomainSchema, 
  signupFormSchema 
} from '../signup';

describe('passwordSchema', () => {
  it('should reject password shorter than 16 characters', () => {
    const result = passwordSchema.safeParse('short123');
    expect(result.success).toBe(false);
  });

  it('should reject password without numbers', () => {
    const result = passwordSchema.safeParse('passwordwithoutdigits');
    expect(result.success).toBe(false);
  });

  it('should reject password without letters', () => {
    const result = passwordSchema.safeParse('12345678901234567890');
    expect(result.success).toBe(false);
  });

  it('should accept valid password', () => {
    const result = passwordSchema.safeParse('ValidPassword1234567');
    expect(result.success).toBe(true);
  });
});

describe('subdomainSchema', () => {
  it('should reject subdomain with uppercase letters', () => {
    const result = subdomainSchema.safeParse('AcmeCorp');
    expect(result.success).toBe(false);
  });

  it('should reject subdomain with spaces', () => {
    const result = subdomainSchema.safeParse('acme corp');
    expect(result.success).toBe(false);
  });

  it('should reject subdomain starting with hyphen', () => {
    const result = subdomainSchema.safeParse('-acme');
    expect(result.success).toBe(false);
  });

  it('should accept valid subdomain', () => {
    const result = subdomainSchema.safeParse('acme-corp');
    expect(result.success).toBe(true);
    expect(result.data).toBe('acme-corp');
  });

  it('should normalize to lowercase', () => {
    const result = subdomainSchema.safeParse('AcmeCorp');
    expect(result.data).toBe('acmecorp');
  });
});

describe('emailSchema', () => {
  it('should reject invalid email format', () => {
    const result = emailSchema.safeParse('notanemail');
    expect(result.success).toBe(false);
  });

  it('should accept valid email', () => {
    const result = emailSchema.safeParse('admin@acme.com');
    expect(result.success).toBe(true);
  });
});

describe('signupFormSchema', () => {
  it('should validate complete form data', () => {
    const validData = {
      companyName: 'Acme Corporation',
      subdomain: 'acme',
      adminEmail: 'admin@acme.com',
      adminPassword: 'SecurePassword123456',
      adminGivenName: 'John',
      adminFamilyName: 'Doe',
    };
    const result = signupFormSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it('should reject form with missing fields', () => {
    const incompleteData = {
      companyName: 'Acme',
      // Missing other fields
    };
    const result = signupFormSchema.safeParse(incompleteData);
    expect(result.success).toBe(false);
  });
});
```

---

## Validation Flow Diagram

```
User Input
    │
    ▼
[Frontend Validation (Zod)]
    │
    ├─── Invalid → Show error message in UI
    │
    ▼
    Valid
    │
    ▼
[API Call to Backend]
    │
    ├─── Backend Validation Fails → Map error to UI
    │
    ▼
    Success
    │
    ▼
[Database Constraints Check]
    │
    ├─── Constraint Violated → Return error (409)
    │
    ▼
    Committed
```

---

## Real-Time Validation Strategy

### Field-Level Validation Timing

| Field | Validation Trigger | Reason |
|-------|-------------------|--------|
| `companyName` | `onBlur` | Don't interrupt typing |
| `subdomain` | `onChange` (debounced 500ms) | Real-time availability check + format validation |
| `adminEmail` | `onBlur` | Don't interrupt typing, validate complete input |
| `adminPassword` | `onChange` (no debounce) | Immediate strength feedback |
| `adminGivenName` | `onBlur` | Don't interrupt typing |
| `adminFamilyName` | `onBlur` | Don't interrupt typing |

---

## References

- **Zod Documentation**: https://zod.dev/
- **React Hook Form + Zod**: https://react-hook-form.com/get-started#SchemaValidation
- **Feature Spec**: `../spec.md` (requirements FR-004, FR-005, FR-006)
- **Backend Validation**: `backend/internal/organization/organization.go`

---

**Status**: ✅ Validation schemas designed, ready for implementation  
**Action Required**: Create validation files and tests after component implementation
