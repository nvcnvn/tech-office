/**
 * Evidence review queue — mobile (Feature 041).
 *
 * A full-screen, single-column list of every pending submission the caller may decide,
 * late instances first then oldest-first. It lives in the tasks area rather than as its
 * own bottom tab: reviewing is part of running the work, and a fifth tab would cost every
 * employee screen width for a surface only reviewers can open.
 *
 * There is no separate "decide" screen. The card carries the evidence and both actions, so
 * the whole loop is scroll, look, approve — the reason this exists on a phone at all.
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  approveEvidenceSubmission,
  classifyReviewDecisionError,
  listEvidenceReviewQueue,
  rejectEvidenceSubmission,
  reviewDecisionRefusalMessage,
  type ReviewQueueEntry,
  type ReviewQueuePage,
} from "apis";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SFIcon } from "@/components/ui/sf-icon";
import { SkeletonList } from "@/components/ui/skeleton";
import { ReviewQueueCard } from "@/components/review/review-queue-card";
import {
  reviewQueueCountQueryKey,
  reviewQueueQueryKey,
} from "@/components/review/review-queue-keys";
import { RejectReasonSheet } from "@/components/review/reject-reason-sheet";
import { useManualRefresh } from "@/hooks/use-manual-refresh";
import {
  border,
  lightPalette,
  mobileLayout,
  mobileTypography,
  opacity,
  radius,
  spacing,
  statusColors,
} from "@tech-office/theme-tokens";

export default function ReviewQueueScreen() {
  const queryClient = useQueryClient();

  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: reviewQueueQueryKey,
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
      await listEvidenceReviewQueue({ cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: ReviewQueuePage) => lastPage.nextCursor,
  });

  const fetched = useMemo<ReviewQueueEntry[]>(
    () => data?.pages.flatMap((page) => page.entries) ?? [],
    [data],
  );

  // Entries removed optimistically, kept out of the rendered list until either the
  // decision lands (they never come back) or it fails (they are put back where they were).
  const [decided, setDecided] = useState<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<ReviewQueueEntry | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const restoreRef = useRef<Map<string, ReviewQueueEntry>>(new Map());

  const entries = useMemo(
    () => fetched.filter((entry) => !decided.has(entry.evidenceSubmissionId)),
    [fetched, decided],
  );

  const refresh = useCallback(async () => {
    await refetch();
    void queryClient.invalidateQueries({ queryKey: reviewQueueCountQueryKey });
  }, [queryClient, refetch]);

  const { isRefreshing, onRefresh } = useManualRefresh(refresh);

  const markDecided = (id: string, isDecided: boolean) =>
    setDecided((prev) => {
      const next = new Set(prev);
      if (isDecided) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });

  const setBusy = (id: string, busy: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });

  const decide = async (entry: ReviewQueueEntry, run: () => Promise<void>) => {
    const id = entry.evidenceSubmissionId;
    setBusy(id, true);
    restoreRef.current.set(id, entry);
    markDecided(id, true);

    try {
      await run();
      restoreRef.current.delete(id);
      // The badge on the tasks tab is the reason someone opens this screen; it has to
      // follow the decision rather than wait for the next cold start.
      void queryClient.invalidateQueries({ queryKey: reviewQueueCountQueryKey });
    } catch (error) {
      const refusal = classifyReviewDecisionError(error);
      // An already-decided submission is genuinely gone from the queue, so it stays
      // removed — putting it back would offer an action that cannot succeed.
      if (refusal.kind !== "already_decided") {
        markDecided(id, false);
      }
      restoreRef.current.delete(id);
      setMessage(reviewDecisionRefusalMessage(refusal));
    } finally {
      setBusy(id, false);
    }
  };

  const handleApprove = (entry: ReviewQueueEntry) =>
    void decide(entry, () => approveEvidenceSubmission(entry.evidenceSubmissionId));

  const handleRejectConfirm = (reason: string) => {
    const entry = rejecting;
    if (!entry) {
      return;
    }
    setRejecting(undefined);
    void decide(entry, () => rejectEvidenceSubmission(entry.evidenceSubmissionId, reason));
  };

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Needs your review" }} />
        <View style={styles.container}>
          <SkeletonList count={5} />
        </View>
      </>
    );
  }

  if (isError) {
    return (
      <>
        <Stack.Screen options={{ title: "Needs your review" }} />
        <View style={styles.center} testID="review-queue-error">
          <Text selectable style={styles.errorText}>The review queue could not be loaded.</Text>
          <Button label="Retry" onPress={() => void refetch()} />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Needs your review" }} />
      <View style={styles.container}>
        {message ? (
          <Pressable
            onPress={() => setMessage(undefined)}
            style={({ pressed }) => [styles.messageBar, pressed && styles.pressed]}
            testID="review-queue-decision-error"
          >
            <SFIcon name="exclamationmark.triangle.fill" size={14} color={statusColors.warning.light.text} />
            <Text style={styles.messageText}>{message}</Text>
            <SFIcon name="xmark" size={12} color={statusColors.warning.light.text} />
          </Pressable>
        ) : null}

        <FlatList
          testID="review-queue-list"
          data={entries}
          keyExtractor={(entry) => entry.evidenceSubmissionId}
          contentContainerStyle={entries.length === 0 ? styles.emptyContent : styles.listContent}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) {
              void fetchNextPage();
            }
          }}
          ListEmptyComponent={
            <View testID="review-queue-empty-state" style={styles.emptyWrap}>
              <EmptyState
                sfSymbol="checkmark.circle"
                title="Nothing to review"
                subtitle="Evidence waiting on your decision shows up here. You are up to date."
              />
            </View>
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={styles.footer}>
                <ActivityIndicator size="small" color={lightPalette.text.secondary} />
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <ReviewQueueCard
              entry={item}
              busy={busyIds.has(item.evidenceSubmissionId)}
              onApprove={handleApprove}
              onReject={setRejecting}
            />
          )}
        />

        <RejectReasonSheet
          entry={rejecting}
          submitting={!!rejecting && busyIds.has(rejecting.evidenceSubmissionId)}
          onCancel={() => setRejecting(undefined)}
          onConfirm={handleRejectConfirm}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: lightPalette.background.default,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1.5],
    padding: mobileLayout.screenPadding,
    backgroundColor: lightPalette.background.default,
  },
  errorText: {
    ...mobileTypography.listPrimary,
    color: lightPalette.text.secondary,
    textAlign: "center",
  },
  listContent: {
    padding: mobileLayout.screenPadding,
    gap: mobileLayout.cardGap,
    paddingBottom: mobileLayout.cardPadding * 2,
  },
  emptyContent: {
    flexGrow: 1,
  },
  emptyWrap: {
    flex: 1,
    minHeight: 320,
  },
  footer: {
    paddingVertical: spacing[2],
    alignItems: "center",
  },
  messageBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: mobileLayout.itemGap,
    margin: mobileLayout.screenPadding,
    marginBottom: 0,
    padding: spacing[1.5],
    borderRadius: radius.base,
    borderCurve: "continuous",
    backgroundColor: statusColors.warning.light.bg,
    borderWidth: border.thin,
    borderColor: statusColors.warning.light.border,
  },
  messageText: {
    flex: 1,
    ...mobileTypography.listSecondary,
    color: statusColors.warning.light.text,
  },
  pressed: {
    opacity: opacity.pressed,
  },
});
