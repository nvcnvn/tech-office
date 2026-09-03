/**
 * Query keys for the evidence review queue (Feature 041).
 *
 * Shared so the tasks-tab badge is invalidated by the same key the queue screen uses after
 * a decision — a divergent literal in either place would leave the badge showing a count
 * the reviewer has already cleared.
 */

export const reviewQueueQueryKey = ["evidence-review-queue"] as const;
export const reviewQueueCountQueryKey = ["evidence-review-queue-count"] as const;
