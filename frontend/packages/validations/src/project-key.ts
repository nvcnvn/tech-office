import { z } from 'zod';

/**
 * The project key rule, mirroring the `valid_project_key` CHECK constraint on
 * `collaboration.project`. The database is the authority; this is the client's copy of it,
 * kept in one place so web and mobile cannot disagree about what they will submit.
 */
export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,9}$/;

export const PROJECT_KEY_RULE_TEXT =
    '1–10 characters, starting with a letter, then letters, numbers or underscores.';

export const projectKeySchema = z.string().regex(PROJECT_KEY_PATTERN, PROJECT_KEY_RULE_TEXT);

/**
 * Suggest a key from a project name.
 *
 * Deliberately lossier than the format rule: it strips underscores, which the rule permits.
 * A hand-typed STORE_OPS is valid but is never suggested. Preserved from the web form as-is
 * so both clients suggest the same key for the same name.
 */
export function deriveProjectKey(name: string): string {
    return name
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .substring(0, 10);
}
