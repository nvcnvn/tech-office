/**
 * A department, as a list of the people in it.
 *
 * This is not a department object: no tree, no manager, no counters. It exists because a
 * department search result rendered like a door and behaved like a wall — tapping one did
 * nothing at all, which reads as a broken app rather than as a scoping decision.
 *
 * The name and the members are two requests issued in the same render, so the screen is
 * bounded by the slower of them rather than by their sum.
 */

import React from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { getDepartment } from "apis";
import { DirectoryRow } from "@/components/common/directory-row";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { useDirectoryList, useOpenPerson } from "@/hooks/use-directory";
import {
  lightPalette,
  mobileLayout,
  mobileTypography,
  spacing,
} from "@tech-office/theme-tokens";

export default function DepartmentMembersScreen() {
  const { departmentId } = useLocalSearchParams<{ departmentId: string }>();
  const id = String(departmentId);
  const openPerson = useOpenPerson();

  const {
    data: department,
    isLoading: isDepartmentLoading,
    isError: isDepartmentError,
    error: departmentError,
  } = useQuery({
    queryKey: ["department", id],
    queryFn: async () => (await getDepartment(id)).department,
    enabled: Boolean(departmentId),
  });

  const {
    data,
    isLoading: areMembersLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useDirectoryList(departmentId ? id : undefined);

  const members = React.useMemo(
    () => (data?.pages ?? []).flatMap((page) => page.entries),
    [data],
  );

  const title = department?.name ?? "Department";

  // A department that has been deleted since the row was saved says so, rather than
  // showing an unnamed empty list.
  if (isDepartmentError) {
    return (
      <>
        <Stack.Screen options={{ title: "Department" }} />
        <EmptyState
          sfSymbol="building.2"
          title="This department is no longer available"
          subtitle={
            departmentError instanceof Error && departmentError.message
              ? departmentError.message
              : "It may have been removed or renamed."
          }
        />
      </>
    );
  }

  if (isDepartmentLoading || areMembersLoading) {
    return (
      <>
        <Stack.Screen options={{ title }} />
        <SkeletonList count={6} variant="double" />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title }} />
      <FlatList
        testID="department-members-list"
        contentInsetAdjustmentBehavior="automatic"
        data={members}
        keyExtractor={(entry) => entry.employeeId}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        // The navigation header already carries the department name, so repeating it
        // here costs a row of a 360 dp screen and says nothing new. The block earns its
        // place only when there is a description to carry.
        ListHeaderComponent={
          department?.description ? (
            <View style={styles.header}>
              <Text style={styles.description}>{department.description}</Text>
            </View>
          ) : null
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
        ListEmptyComponent={
          <View testID="department-empty">
            <EmptyState
              sfSymbol="person.2"
              title={`Nobody is in ${title} yet`}
              subtitle="When someone is assigned to this department, they will appear here."
            />
          </View>
        }
        renderItem={({ item }) => (
          <DirectoryRow
            entry={item}
            onPress={() =>
              openPerson(item, title, `/(app)/(more)/people/department/${id}`)
            }
          />
        )}
      />
    </>
  );
}

const styles = StyleSheet.create({
  listContent: {
    flexGrow: 1,
    paddingBottom: spacing[6],
  },
  header: {
    padding: mobileLayout.screenPadding,
    gap: spacing[0.5],
  },
  description: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    color: lightPalette.text.secondary,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: lightPalette.divider,
    marginLeft: mobileLayout.cardPadding,
  },
});
