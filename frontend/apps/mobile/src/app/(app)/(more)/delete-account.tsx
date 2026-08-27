/**
 * Delete account (Feature 036, FR-001/FR-002).
 *
 * The screen branches on what the server says the person's path is, rather than
 * inferring it from anything client-side: a self-registered person deletes their
 * account here, an admin-provisioned worker is sent to the removal-request screen
 * instead (FR-007b).
 *
 * Everything the confirmation states — what is erased, what is kept and why, which
 * workspaces are affected, and the phrase to type — comes from the server, so this
 * screen and the web one cannot drift into describing different behaviour.
 */

import React from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import {
  deleteMyAccount,
  extractSoleOwnerBlocksDeletion,
  getAccountDeletionPreview,
  getAccountRemovalPath,
  type AccountDeletionPreview,
  type BlockingOrganizationSummary,
} from "apis";

import { AuthContext } from "@/hooks/use-auth";
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

export default function DeleteAccountScreen() {
  const auth = React.use(AuthContext);
  const router = useRouter();

  const [preview, setPreview] = React.useState<AccountDeletionPreview | null>(null);
  const [phrase, setPhrase] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [blocking, setBlocking] = React.useState<BlockingOrganizationSummary[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const path = await getAccountRemovalPath();
        if (cancelled) return;
        if (path.path === "request_removal") {
          // Their account belongs to the workspace that created it, so the honest
          // screen is the request one — not this one with a disabled button.
          router.replace("/(app)/(more)/request-removal");
          return;
        }
        const next = await getAccountDeletionPreview();
        if (cancelled) return;
        setPreview(next);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error && err.message
              ? err.message
              : "We couldn't load your account details.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const confirmationPhrase = preview?.confirmationPhrase ?? "";
  const phraseMatches =
    confirmationPhrase.length > 0 &&
    phrase.trim().toLowerCase() === confirmationPhrase.toLowerCase();

  const submit = () => {
    Alert.alert(
      "Delete your account?",
      "This cannot be undone. You'll be signed out on every device straight away.",
      [
        { text: "Keep my account", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void performDelete(),
        },
      ],
    );
  };

  const performDelete = async () => {
    setSubmitting(true);
    setError("");
    setBlocking([]);
    try {
      await deleteMyAccount(phrase.trim());
      // Sessions are already gone server-side; clearing local state is what makes
      // the app agree with that.
      await auth?.signOut();
    } catch (err) {
      const blocked = extractSoleOwnerBlocksDeletion(err);
      if (blocked.length > 0) {
        setBlocking(blocked);
      } else {
        setError(
          err instanceof Error && err.message
            ? err.message
            : "We couldn't delete your account. Try again.",
        );
      }
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <Stack.Screen options={{ title: "Delete account" }} />
        <ActivityIndicator color={lightPalette.text.secondary} />
      </View>
    );
  }

  const blockedOrgs = blocking.length > 0
    ? blocking
    : (preview?.organizations ?? []).filter((org) => org.blocksDeletion).map((org) => ({
        organizationId: org.organizationId,
        organizationName: org.organizationName,
        memberCount: org.memberCount,
      }));

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <Stack.Screen options={{ title: "Delete account" }} />

      <Card style={styles.headerCard}>
        <View style={styles.headerIconWrap}>
          <SFIcon name="exclamationmark.triangle.fill" size={18} color={lightPalette.error.main} />
        </View>
        <Text style={styles.headerTitle}>Deleting your account can't be undone</Text>
        <Text style={styles.headerBody}>
          Read what happens below. You'll be signed out on every device straight away.
        </Text>
      </Card>

      {blockedOrgs.length > 0 ? (
        <Card style={styles.blockedCard}>
          <View testID="delete-account-blocked" />
          <Text style={styles.blockedTitle}>
            You're the only owner of {blockedOrgs.length === 1 ? "a workspace" : "some workspaces"} that
            still {blockedOrgs.length === 1 ? "has" : "have"} people in {blockedOrgs.length === 1 ? "it" : "them"}
          </Text>
          <Text style={styles.blockedBody}>
            Deleting now would leave your team without anyone who can run the workspace. Make
            somebody else an owner, or close the workspace, then come back here.
          </Text>
          {blockedOrgs.map((org) => (
            <View key={org.organizationId} style={styles.blockedRow}>
              <SFIcon name="building.2" size={14} color={lightPalette.text.secondary} />
              <Text selectable style={styles.blockedRowText}>
                {org.organizationName} — {org.memberCount}{" "}
                {org.memberCount === 1 ? "other person" : "other people"}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Card style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>What gets deleted</Text>
        {(preview?.erased ?? []).map((item) => (
          <View key={item.label} style={styles.bulletRow}>
            <SFIcon name="minus.circle" size={14} color={lightPalette.error.main} />
            <Text style={styles.bulletText}>{item.label}</Text>
          </View>
        ))}
      </Card>

      <Card style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>What stays, and why</Text>
        {(preview?.retained ?? []).map((item) => (
          <View key={item.label} style={styles.retainedRow}>
            <Text style={styles.retainedLabel}>{item.label}</Text>
            <Text style={styles.retainedReason}>{item.reason}</Text>
          </View>
        ))}
      </Card>

      {(preview?.organizations ?? []).length > 0 ? (
        <Card style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Workspaces this affects</Text>
          {(preview?.organizations ?? []).map((org) => (
            <View key={org.organizationId} style={styles.bulletRow}>
              <SFIcon name="building.2" size={14} color={lightPalette.text.secondary} />
              <Text selectable style={styles.bulletText}>
                {org.organizationName}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Card style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Confirm</Text>
        <Text style={styles.confirmHint}>
          Type <Text style={styles.confirmPhrase}>{confirmationPhrase}</Text> to confirm.
        </Text>
        <TextInput
          style={styles.input}
          value={phrase}
          onChangeText={setPhrase}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!submitting}
          placeholder={confirmationPhrase}
          placeholderTextColor={lightPalette.text.disabled}
          testID="delete-account-phrase"
        />

        {error ? (
          <Text selectable style={styles.error} testID="delete-account-error">
            {error}
          </Text>
        ) : null}

        <Pressable
          onPress={submit}
          disabled={!phraseMatches || submitting || blockedOrgs.length > 0}
          style={({ pressed }) => [
            styles.dangerButton,
            (!phraseMatches || submitting || blockedOrgs.length > 0) && styles.dangerButtonDisabled,
            pressed && styles.pressed,
          ]}
          testID="delete-account-submit"
        >
          {submitting ? (
            <ActivityIndicator size="small" color={lightPalette.primary.contrastText} />
          ) : (
            <Text style={styles.dangerButtonText}>Delete my account</Text>
          )}
        </Pressable>
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
    backgroundColor: "#fceceb",
  },
  headerTitle: {
    ...mobileTypography.sectionHeader,
    color: lightPalette.text.primary,
  },
  headerBody: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
  },
  blockedCard: {
    gap: spacing[1],
    backgroundColor: "#fff7ed",
  },
  blockedTitle: {
    ...mobileTypography.listPrimary,
    color: lightPalette.text.primary,
    fontWeight: "600",
  },
  blockedBody: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
  },
  blockedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  blockedRowText: {
    flex: 1,
    ...mobileTypography.listSecondary,
    color: lightPalette.text.primary,
  },
  sectionCard: {
    gap: spacing[1],
  },
  sectionTitle: {
    ...mobileTypography.sectionHeader,
    color: lightPalette.text.primary,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[1],
  },
  bulletText: {
    flex: 1,
    ...mobileTypography.listSecondary,
    color: lightPalette.text.primary,
  },
  retainedRow: {
    gap: 2,
  },
  retainedLabel: {
    ...mobileTypography.listPrimary,
    color: lightPalette.text.primary,
  },
  retainedReason: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
  },
  confirmHint: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
  },
  confirmPhrase: {
    fontWeight: "700",
    color: lightPalette.text.primary,
  },
  input: {
    minHeight: 48,
    borderRadius: radius.base,
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    backgroundColor: lightPalette.background.default,
    paddingHorizontal: spacing[1.5],
    ...mobileTypography.listPrimary,
    color: lightPalette.text.primary,
  },
  error: {
    ...mobileTypography.caption,
    color: lightPalette.error.main,
  },
  dangerButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.base,
    borderCurve: "continuous",
    backgroundColor: lightPalette.error.main,
    marginTop: spacing[1],
  },
  dangerButtonDisabled: {
    opacity: 0.4,
  },
  dangerButtonText: {
    ...mobileTypography.listPrimary,
    color: lightPalette.primary.contrastText,
    fontWeight: "600",
  },
  pressed: {
    opacity: opacity.pressed,
  },
});
