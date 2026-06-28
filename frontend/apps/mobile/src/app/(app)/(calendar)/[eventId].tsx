/**
 * Event detail screen
 */

import React, { useCallback, useMemo } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, Platform, Alert, Share } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getEvent, respondToInvite, checkInToEvent, type RSVPStatus, getProfile } from "apis";
import { useAuth } from "@/hooks/use-auth";
import { generateCanonicalUrl } from "@/lib/canonical-links";
import { format } from "date-fns";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";

export default function EventDetailScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const queryClient = useQueryClient();
  const auth = useAuth();

  const { data: profileData } = useQuery({
    queryKey: ["profile", "event-share"],
    queryFn: () => getProfile(),
    enabled: auth.isAuthenticated,
    staleTime: 300_000,
  });

  const currentMembership = useMemo(
    () =>
      profileData?.organizations.find((org) => org.organizationId === auth.organizationId) ??
      profileData?.organizations[0],
    [auth.organizationId, profileData]
  );

  const handleShareEventLink = useCallback(async () => {
    if (!currentMembership?.organizationSubdomain || !eventId) return;
    const url = await generateCanonicalUrl(currentMembership.organizationSubdomain, "calendar", eventId);
    if (url) {
      await Share.share({ message: url, url });
    }
  }, [currentMembership, eventId]);

  const { data: event, isLoading } = useQuery({
    queryKey: ["event", eventId],
    queryFn: async () => {
      const result = await getEvent(eventId!);
      return result;
    },
    enabled: !!eventId,
  });

  const rsvpMutation = useMutation({
    mutationFn: async (response: RSVPStatus) => {
      await respondToInvite(eventId!, response);
    },
    onSuccess: () => {
      if (Platform.OS === "ios") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      queryClient.invalidateQueries({ queryKey: ["event", eventId] });
    },
  });

  const checkInMutation = useMutation({
    mutationFn: async () => {
      // Request location permission
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        throw new Error("Location permission denied");
      }
      // Get current position (used for client-side context; server validates geofence)
      await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      return checkInToEvent(eventId!);
    },
    onSuccess: () => {
      if (Platform.OS === "ios") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      queryClient.invalidateQueries({ queryKey: ["event", eventId] });
      Alert.alert("Checked in!", "Your attendance has been recorded.");
    },
    onError: (err: Error) => {
      Alert.alert("Check-in failed", err.message);
    },
  });

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const ev = event as any;

  return (
    <>
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 20 }}
    >
      <Stack.Screen
        options={{
          title: ev?.title ?? "Event",
        }}
      />

      {/* Time */}
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: "#666" }}>
          When
        </Text>
        <Text style={{ fontSize: 15 }}>
          {ev?.startTime
            ? format(new Date(ev.startTime), "EEEE, MMM d · h:mm a")
            : "—"}
          {ev?.endTime
            ? ` — ${format(new Date(ev.endTime), "h:mm a")}`
            : ""}
        </Text>
      </View>

      {/* Location */}
      {ev?.location && (
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: "#666" }}>
            Location
          </Text>
          <Text selectable style={{ fontSize: 15 }}>
            {ev.location}
          </Text>
        </View>
      )}

      {/* Description */}
      {ev?.description && (
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: "#666" }}>
            Description
          </Text>
          <Text selectable style={{ fontSize: 15, lineHeight: 22 }}>
            {ev.description}
          </Text>
        </View>
      )}

      {/* RSVP */}
      <View style={{ gap: 8, marginTop: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: "#666" }}>
          RSVP
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["accepted", "declined", "tentative"] as RSVPStatus[]).map((response) => (
            <Pressable
              key={response}
              onPress={() => rsvpMutation.mutate(response)}
              disabled={rsvpMutation.isPending}
              style={({ pressed }) => ({
                flex: 1,
                backgroundColor:
                  response === "accepted"
                    ? pressed ? "#388e3c" : "#16a34a"
                    : response === "declined"
                    ? pressed ? "#991b1b" : "#f87171"
                    : pressed ? "#f57c00" : "#d97706",
                paddingVertical: 12,
                borderRadius: 10,
                borderCurve: "continuous",
                alignItems: "center",
              })}
            >
              <Text style={{ color: "#fff", fontWeight: "600", fontSize: 14 }}>
                {response === "accepted"
                  ? "Accept"
                  : response === "declined"
                  ? "Decline"
                  : "Maybe"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* GPS Check-In (T7.6) — shown when event requires check-in */}
      {ev?.requiresCheckIn && (
        <View style={{ gap: 8, marginTop: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: "#666" }}>
            Check-In
          </Text>
          <Pressable
            onPress={() => checkInMutation.mutate()}
            disabled={checkInMutation.isPending}
            style={({ pressed }) => ({
              backgroundColor: checkInMutation.isPending
                ? "#94a3b8"
                : pressed
                ? "#020617"
                : "#0f172a",
              paddingVertical: 14,
              borderRadius: 12,
              borderCurve: "continuous",
              alignItems: "center",
              flexDirection: "row",
              justifyContent: "center",
              gap: 8,
            } as any)}
          >
            {checkInMutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={{ fontSize: 18 }}>📍</Text>
                <Text style={{ color: "#fff", fontWeight: "600", fontSize: 15 }}>
                  Check In at Location
                </Text>
              </>
            )}
          </Pressable>
        </View>
      )}
    </ScrollView>
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu icon="ellipsis.circle">
        <Stack.Toolbar.MenuAction
          icon="square.and.arrow.up"
          onPress={() => { void handleShareEventLink(); }}
        >
          Share Link
        </Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
    </>
  );
}
