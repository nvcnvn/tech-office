/**
 * Request removal (Feature 036, FR-007b/FR-007c).
 *
 * The screen an admin-provisioned worker gets instead of self-deletion. Their
 * account and its content are the employer's record, so they ask the people who
 * run the workspace rather than deleting it themselves.
 *
 * The in-app request is what makes this path compliant: telling a worker to
 * "contact your administrator" and stopping there is the off-app deletion route
 * both stores reject. This sends the request and notifies an owner who can act.
 */

import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import {
  getAccountRemovalPath,
  requestAccountRemoval,
  type AccountRemovalPathSummary,
} from "apis";

import { Card } from "@/components/ui/card";
import { SFIcon } from "@/components/ui/sf-icon";
import {
  border,
  lightPalette,
  mobileLayout,
  mobileTypography,
  opacity,
  radius,
  spacing,
} from "@tech-office/theme-tokens";

const STATUS_COPY: Record<string, { title: string; body: string }> = {
  outstanding: {
    title: "Your request is with the workspace owners",
    body: "They've been notified. You'll keep your access until one of them decides.",
  },
  granted: {
    title: "Your request was granted",
    body: "You've been removed from this workspace. Anything that identified you has been erased.",
  },
  declined: {
    title: "Your request was declined",
    body: "The workspace owners decided not to remove your account. You can ask again if your situation changes.",
  },
};

export default function RequestRemovalScreen() {
  const router = useRouter();
  const [path, setPath] = React.useState<AccountRemovalPathSummary | null>(null);
  const [note, setNote] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    setError("");
    try {
      const next = await getAccountRemovalPath();
      if (next.path === "self_delete") {
        // This person creates and owns their own account, so the honest screen is
        // the deletion one.
        router.replace("/(app)/(more)/delete-account");
        return;
      }
      setPath(next);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "We couldn't load your account details.",
      );
    } finally {
      setLoading(false);
    }
  }, [router]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      await requestAccountRemoval(note.trim() || undefined);
      await load();
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "We couldn't send your request. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <Stack.Screen options={{ title: "Remove my account" }} />
        <ActivityIndicator color={lightPalette.text.secondary} />
      </View>
    );
  }

  const latest = path?.latestRequest;
  const status = latest ? STATUS_COPY[latest.status] : undefined;
  const outstanding = latest?.status === "outstanding";

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <Stack.Screen options={{ title: "Remove my account" }} />

      <Card style={styles.headerCard}>
        <View style={styles.headerIconWrap}>
          <SFIcon name="building.2" size={18} color={lightPalette.primary.main} />
        </View>
        <Text style={styles.headerTitle}>
          {path?.managingOrganizationName || "Your workspace"} manages this account
        </Text>
        <Text style={styles.headerBody}>
          Somebody at {path?.managingOrganizationName || "your workspace"} created this
          account for you, and the work in it is that business's record. So you ask them to
          remove it rather than deleting it yourself — and you can do that right here.
        </Text>
      </Card>

      {status ? (
        <Card style={styles.statusCard}>
          <View testID="removal-request-status" />
          <Text style={styles.statusTitle}>{status.title}</Text>
          <Text style={styles.statusBody}>{status.body}</Text>
        </Card>
      ) : null}

      {!outstanding ? (
        <Card style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Send a request</Text>
          <Text style={styles.sectionBody}>
            The owners of {path?.managingOrganizationName || "this workspace"} are notified
            straight away. Adding a reason is optional.
          </Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            multiline
            editable={!submitting}
            placeholder="Why you'd like to be removed (optional)"
            placeholderTextColor={lightPalette.text.disabled}
            testID="removal-request-note"
          />

          {error ? (
            <Text selectable style={styles.error} testID="removal-request-error">
              {error}
            </Text>
          ) : null}

          <Pressable
            onPress={submit}
            disabled={submitting}
            style={({ pressed }) => [
              styles.primaryButton,
              submitting && styles.primaryButtonDisabled,
              pressed && styles.pressed,
            ]}
            testID="removal-request-submit"
          >
            {submitting ? (
              <ActivityIndicator size="small" color={lightPalette.primary.contrastText} />
            ) : (
              <Text style={styles.primaryButtonText}>Request removal</Text>
            )}
          </Pressable>
        </Card>
      ) : null}

      <Card style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>What happens if they agree</Text>
        <Text style={styles.sectionBody}>
          Your name, contact details and sign-in credentials are erased, and you're signed
          out everywhere. The messages, files and tasks you worked on stay with the
          workspace as its record of its own work, attributed to nobody.
        </Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.background.default,
  },
  screen: {
    flex: 1,
    backgroundColor: lightPalette.background.default,
  },
  content: {
    padding: mobileLayout.screenPadding,
    gap: mobileLayout.cardGap,
    paddingBottom: spacing[6],
  },
  headerCard: {
    gap: spacing[1],
  },
  headerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.base,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef5fc",
  },
  headerTitle: {
    ...mobileTypography.sectionHeader,
    color: lightPalette.text.primary,
  },
  headerBody: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
  },
  statusCard: {
    gap: spacing[0.5],
    backgroundColor: "#eef5fc",
  },
  statusTitle: {
    ...mobileTypography.listPrimary,
    color: lightPalette.text.primary,
    fontWeight: "600",
  },
  statusBody: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
  },
  sectionCard: {
    gap: spacing[1],
  },
  sectionTitle: {
    ...mobileTypography.sectionHeader,
    color: lightPalette.text.primary,
  },
  sectionBody: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
  },
  input: {
    minHeight: 72,
    borderRadius: radius.base,
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    backgroundColor: lightPalette.background.default,
    padding: spacing[1.5],
    textAlignVertical: "top",
    ...mobileTypography.listSecondary,
    color: lightPalette.text.primary,
  },
  error: {
    ...mobileTypography.caption,
    color: lightPalette.error.main,
  },
  primaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.base,
    borderCurve: "continuous",
    backgroundColor: lightPalette.primary.main,
    marginTop: spacing[1],
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    ...mobileTypography.listPrimary,
    color: lightPalette.primary.contrastText,
    fontWeight: "600",
  },
  pressed: {
    opacity: opacity.pressed,
  },
});
