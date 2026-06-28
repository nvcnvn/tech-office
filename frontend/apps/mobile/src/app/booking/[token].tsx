/**
 * Booking deep link — public booking page
 *
 * Handles links like: techoffice://booking/<token>
 * Shows available slots and allows the user to book an appointment.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getBookingLinkByToken, claimBookingSlot, type FreeBusySlot } from "apis";
import { format } from "date-fns";
import * as Haptics from "expo-haptics";

export default function BookingScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [selectedSlot, setSelectedSlot] = useState<FreeBusySlot | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["booking", token],
    queryFn: () => getBookingLinkByToken(token!),
    enabled: !!token,
  });

  const bookMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSlot?.start) throw new Error("No slot selected");
      await claimBookingSlot(token!, selectedSlot.start);
    },
    onSuccess: () => {
      if (Platform.OS === "ios") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setConfirmed(true);
    },
    onError: (err) => {
      Alert.alert("Booking Failed", err.message);
    },
  });

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <Stack.Screen options={{ title: "Book Appointment" }} />
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
        <Stack.Screen options={{ title: "Booking" }} />
        <Text style={{ fontSize: 18, fontWeight: "600", marginBottom: 8 }}>
          Booking not found
        </Text>
        <Text style={{ color: "#666", textAlign: "center" }}>
          This booking link may have expired or is invalid.
        </Text>
      </View>
    );
  }

  const { bookingLink, availableSlots } = data;

  if (confirmed) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 16 }}>
        <Stack.Screen options={{ title: "Confirmed!" }} />
        <Text style={{ fontSize: 48 }}>✅</Text>
        <Text style={{ fontSize: 22, fontWeight: "700" }}>Booking Confirmed!</Text>
        <Text style={{ fontSize: 15, color: "#666", textAlign: "center" }}>
          Your appointment has been booked.
        </Text>
      </View>
    );
  }

  const freeSlots = availableSlots.filter((s) => s.isFree && s.start && s.end);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 20 }}
    >
      <Stack.Screen options={{ title: bookingLink.title ?? "Book Appointment" }} />

      {/* Header info */}
      <View
        style={{
          backgroundColor: "#f8f9fa",
          borderRadius: 16,
          borderCurve: "continuous",
          padding: 16,
          gap: 4,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: "700" }}>
          {bookingLink.title ?? "Book a time"}
        </Text>
        {bookingLink.durationMinutes && (
          <Text style={{ fontSize: 14, color: "#2563eb" }}>
            ⏱ {bookingLink.durationMinutes} minutes
          </Text>
        )}
      </View>

      {/* Available slots */}
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: "#666" }}>
          AVAILABLE TIMES
        </Text>
        {freeSlots.length === 0 ? (
          <Text style={{ color: "#666", padding: 16 }}>
            No available slots at this time.
          </Text>
        ) : (
          freeSlots.map((slot, index) => {
            const isSelected = selectedSlot?.start?.getTime() === slot.start?.getTime();
            return (
              <Pressable
                key={index}
                onPress={() => setSelectedSlot(slot)}
                style={{
                  padding: 14,
                  borderRadius: 12,
                  borderCurve: "continuous",
                  borderWidth: 1.5,
                  borderColor: isSelected ? "#0f172a" : "#e2e8f0",
                  backgroundColor: isSelected ? "#e3f2fd" : "#fff",
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <View>
                  <Text style={{ fontSize: 15, fontWeight: "600" }}>
                    {format(slot.start!, "EEEE, MMM d")}
                  </Text>
                  <Text style={{ fontSize: 14, color: "#666" }}>
                    {format(slot.start!, "h:mm a")} – {format(slot.end!, "h:mm a")}
                  </Text>
                </View>
                {isSelected && (
                  <Text style={{ fontSize: 20, color: "#0f172a" }}>✓</Text>
                )}
              </Pressable>
            );
          })
        )}
      </View>

      {/* Confirm button */}
      <Pressable
        onPress={() => bookMutation.mutate()}
        disabled={!selectedSlot || bookMutation.isPending}
        style={({ pressed }) => ({
          backgroundColor:
            !selectedSlot ? "#ccc" : pressed ? "#020617" : "#0f172a",
          paddingVertical: 16,
          borderRadius: 12,
          alignItems: "center",
          marginTop: 8,
        })}
      >
        {bookMutation.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>
            Confirm Booking
          </Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
