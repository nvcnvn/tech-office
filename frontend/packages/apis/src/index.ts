/**
 * @packageDocumentation
 * APIs package - Centralized API client functions and types
 * 
 * This package provides ConnectRPC-based API clients for:
 * - Authentication (IAM)
 * - Organization management
 * - Token handling
 * 
 * @example
 * ```ts
 * import { getOrganizationBySubdomain, verifyUserEmail, AuthError } from 'apis';
 * 
 * try {
 *   const org = await getOrganizationBySubdomain('acme');
 *   await verifyUserEmail(org.email);
 * } catch (err) {
 *   if (err instanceof AuthError) {
 *     // Handle auth error
 *   }
 * }
 * ```
 */

// Export error classes
export * from './errors';

// Export platform adapter interface (Feature 027: mobile-app-planning)
export * from './platform';

// Export auth failure events for app-level session reset handling
export * from './auth-events';

// Export error detail extractors (Feature 024: PIN-based auth error details)
export * from './errorDetails';

// Export org-managed account API functions (Feature 024: PIN-based auth)
export * from './iam-org-accounts';

// Export protobuf type conversion utilities
export * from './proto-utils';

// Export organization functions
export * from './organization';

// Export department functions
export * from './department';

// Export notification functions
export * from './notification';

// Export notification status utilities
export * from './notification-status';

// Export presence functions
export * from './presence';

// Export push token functions
export * from './push-tokens';

// Export visibility functions
export * from './visibility';

// Export chat functions
export * from './chat';

// Export shared chat reaction utilities
export * from './chat-reactions';

// Export preference functions
export * from './preference';

// Export file storage functions (Feature 014: basic upload/download)
export * from './files';

// Export chat file upload functions (Feature 015: domain-owned upload flow)
export * from './chat-files';

// Export file security functions (Feature 015: validation, access control, search)
export * from './files-security';

// Export document management functions (Feature 016: docs-sys-basic-implementation)
export * from './docs';

// Export collaboration functions (Feature 017: realtime-task-collaboration-system)
export * from './collaboration';

// Export ritual task functions (Feature 022: recurring-ritual-tasks-system)
export * from './collaboration-ritual';

// Export calendar functions (Feature 026: calendar-system)
export * from './calendar';

// Export voice communication functions (Feature 032: voice communication support)
export * from './voice';

// Export file storage components (STUB: Temporary for backward compatibility)
export { FileUploadWidget } from './components/FileUploadWidget';
export type { FileUploadWidgetProps } from './components/FileUploadWidget';

// Export theme storage utilities
export * from './theme-storage';

// Export utility functions
export * from './utils/text';

// Export search aggregation functions
export * from './search';

// Export search types (excluding ChannelType which is already exported from chat)
export type {
	EmployeeSearchResult,
	EmployeeSuggestion,
	DepartmentSearchResult,
	DepartmentSuggestion,
	ChannelSearchResult,
	ChannelSuggestion,
	MessageSearchResult,
	SearchCategory,
} from './types/search';

// Export IAM constants and types
export * from './iam';

// Export IAM employee import functions
export * from './iam-employee-import';

// Export IAM employee listing functions
export * from './iam-employee-list';

// Export RPC clients and transport
export * from './rpc';

// Export token functions
export * from './token';

// Export type definitions
export * from './types';

// Re-export RPC namespaces for convenience
export { iam, organizations, rbac, department, notification, preference, document, collaboration } from 'rpc';
