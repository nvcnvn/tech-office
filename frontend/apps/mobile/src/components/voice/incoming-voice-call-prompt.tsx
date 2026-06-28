import React, { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SFIcon } from "@/components/ui/sf-icon";
import {
  border,
  getPalette,
  mobileTypography,
  opacity,
  radius,
  spacing,
} from "@tech-office/theme-tokens";

interface IncomingVoiceCallPromptProps {
  title: string;
  body: string;
  alreadyInAnotherCall?: boolean;
  loadingAction?: "accept" | "decline" | null;
  error?: string | null;
  onAccept: () => void;
  onDecline: () => void;
}

export function IncomingVoiceCallPrompt({
  title,
  body,
  alreadyInAnotherCall = false,
  loadingAction = null,
  error,
  onAccept,
  onDecline,
}: IncomingVoiceCallPromptProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const translateY = useRef(new Animated.Value(-160)).current;
  const opacityValue = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const palette = getPalette(colorScheme === "dark" ? "dark" : "light");
  const isDark = palette.mode === "dark";
  const isBusy = Boolean(loadingAction);
  const acceptLabel = alreadyInAnotherCall ? "Switch" : "Answer";
  const declineLabel = alreadyInAnotherCall ? "Stay" : "Decline";

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 68,
        friction: 9,
      }),
      Animated.timing(opacityValue, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacityValue, translateY]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 850,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 850,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();

    Vibration.vibrate([0, 650, 900], true);

    return () => {
      loop.stop();
      Vibration.cancel();
    };
  }, [pulse]);

  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.16],
  });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.18, 0.36],
  });
  const resolvedBody =
    body ||
    (alreadyInAnotherCall
      ? "Switch to answer, or stay in your current call."
      : "Answer from this conversation.");

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          opacity: opacityValue,
          paddingTop: insets.top + 10,
          transform: [{ translateY }],
        },
      ]}
    >
      <View
        testID="incoming-voice-call-prompt"
        style={[
          styles.card,
          {
            backgroundColor: palette.background.paper,
            borderColor: isDark ? "rgba(96, 165, 250, 0.36)" : "#bfdbfe",
            boxShadow: isDark
              ? "0 14px 32px rgba(0, 0, 0, 0.42)"
              : "0 14px 32px rgba(15, 23, 42, 0.14)",
          },
        ]}
      >
        <View style={styles.headerRow}>
          <View style={styles.ringWrap}>
            <Animated.View
              style={[
                styles.pulseRing,
                {
                  opacity: pulseOpacity,
                  transform: [{ scale: pulseScale }],
                },
              ]}
            />
            <View style={styles.iconWrap}>
              <SFIcon name="phone.fill" size={21} color="#ffffff" />
            </View>
          </View>

          <View style={styles.textWrap}>
            <Text style={[styles.eyebrow, { color: palette.primary.main }]}>Ringing</Text>
            <Text numberOfLines={1} style={[styles.title, { color: palette.text.primary }]}>
              {title}
            </Text>
            <Text numberOfLines={2} style={[styles.body, { color: palette.text.secondary }]}>
              {resolvedBody}
            </Text>
            {error ? (
              <Text numberOfLines={2} style={styles.error}>
                {error}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            testID="global-incoming-voice-decline-button"
            accessibilityRole="button"
            accessibilityLabel={declineLabel}
            disabled={isBusy}
            onPress={onDecline}
            style={({ pressed }) => [
              styles.declineButton,
              { borderColor: palette.divider, backgroundColor: palette.background.default },
              pressed && styles.pressed,
              isBusy && styles.disabled,
            ]}
          >
            {loadingAction === "decline" ? (
              <ActivityIndicator size="small" color={palette.text.secondary} />
            ) : (
              <Text style={[styles.declineText, { color: palette.text.primary }]}>{declineLabel}</Text>
            )}
          </Pressable>

          <Pressable
            testID="global-incoming-voice-accept-button"
            accessibilityRole="button"
            accessibilityLabel={acceptLabel}
            disabled={isBusy}
            onPress={onAccept}
            style={({ pressed }) => [
              styles.acceptButton,
              pressed && styles.pressed,
              isBusy && styles.disabled,
            ]}
          >
            {loadingAction === "accept" ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <>
                <SFIcon name="phone.fill" size={16} color="#ffffff" />
                <Text style={styles.acceptText}>{acceptLabel}</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 40,
  },
  card: {
    marginHorizontal: spacing[3],
    borderRadius: radius.lg,
    borderCurve: "continuous",
    borderWidth: border.thin,
    padding: spacing[3],
    gap: spacing[3],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  ringWrap: {
    width: 54,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  pulseRing: {
    position: "absolute",
    width: 54,
    height: 54,
    borderRadius: radius.full,
    backgroundColor: "#16a34a",
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#16a34a",
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    fontSize: mobileTypography.caption.fontSize,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  title: {
    marginTop: 2,
    fontSize: mobileTypography.listPrimary.fontSize,
    fontWeight: "800",
  },
  body: {
    marginTop: 2,
    fontSize: mobileTypography.caption.fontSize,
  },
  error: {
    marginTop: spacing[1],
    color: "#dc2626",
    fontSize: mobileTypography.caption.fontSize,
    fontWeight: "600",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  declineButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.full,
    borderWidth: border.thin,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[3],
  },
  acceptButton: {
    flex: 1.25,
    minHeight: 44,
    borderRadius: radius.full,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    backgroundColor: "#16a34a",
  },
  declineText: {
    fontSize: mobileTypography.button.fontSize,
    fontWeight: mobileTypography.button.fontWeight,
  },
  acceptText: {
    color: "#ffffff",
    fontSize: mobileTypography.button.fontSize,
    fontWeight: mobileTypography.button.fontWeight,
  },
  pressed: {
    opacity: opacity.pressed,
  },
  disabled: {
    opacity: opacity.disabled,
  },
});