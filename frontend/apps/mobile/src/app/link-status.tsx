import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { border, lightPalette, mobileLayout, mobileTypography, radius, spacing } from '@tech-office/theme-tokens';

type LinkStatus = 'access_denied' | 'not_found' | 'fallback';

function describeStatus(status: LinkStatus) {
	switch (status) {
		case 'access_denied':
			return {
				title: 'Access denied',
				description: 'This shared link points to a resource you cannot open with the current account.',
				primaryLabel: 'Go to workspace',
			};
		case 'not_found':
			return {
				title: 'Resource not found',
				description: 'The shared link was valid, but the target resource is no longer available.',
				primaryLabel: 'Go to workspace',
			};
		default:
			return {
				title: 'Open a fallback destination',
				description: 'This link was recognized, but this device cannot open the exact mobile destination. You can still continue from a safe fallback route.',
				primaryLabel: 'Open fallback',
			};
	}
}

export default function LinkStatusScreen() {
	const router = useRouter();
	const params = useLocalSearchParams<{ status?: string; fallback?: string; browserUrl?: string }>();
	const status = (typeof params.status === 'string' ? params.status : 'fallback') as LinkStatus;
	const fallback = typeof params.fallback === 'string' && params.fallback ? params.fallback : '/(app)';
	const browserUrl = typeof params.browserUrl === 'string' && params.browserUrl ? params.browserUrl : undefined;
	const content = describeStatus(status);

	return (
		<>
			<Stack.Screen options={{ title: content.title }} />
			<View style={styles.screen}>
				<View style={styles.card}>
					<Text style={styles.title}>{content.title}</Text>
					<Text style={styles.description}>{content.description}</Text>
					<Pressable onPress={() => router.replace(fallback)} style={styles.primaryButton}>
						<Text style={styles.primaryButtonText}>{content.primaryLabel}</Text>
					</Pressable>
					{browserUrl ? (
						<Pressable onPress={() => void Linking.openURL(browserUrl)} style={styles.secondaryButton}>
							<Text style={styles.secondaryButtonText}>Open in browser</Text>
						</Pressable>
					) : null}
					{status === 'fallback' ? (
						<Pressable onPress={() => router.replace('/(app)')} style={styles.secondaryButton}>
							<Text style={styles.secondaryButtonText}>Go home</Text>
						</Pressable>
					) : null}
				</View>
			</View>
		</>
	);
}

const styles = StyleSheet.create({
	screen: {
		flex: 1,
		backgroundColor: lightPalette.background.default,
		paddingHorizontal: mobileLayout.screenPadding,
		paddingVertical: spacing[3],
		justifyContent: 'center',
	},
	card: {
		backgroundColor: lightPalette.background.paper,
		borderRadius: radius.xl,
		padding: mobileLayout.cardPadding,
		borderWidth: border.hairline,
		borderColor: lightPalette.divider,
		gap: 16,
	},
	title: {
		fontSize: mobileTypography.screenTitle.fontSize,
		fontWeight: mobileTypography.screenTitle.fontWeight,
		lineHeight: mobileTypography.screenTitle.lineHeight,
		color: lightPalette.text.primary,
	},
	description: {
		fontSize: mobileTypography.listSecondary.fontSize,
		lineHeight: mobileTypography.listSecondary.lineHeight,
		color: lightPalette.text.secondary,
	},
	primaryButton: {
		borderRadius: radius.lg,
		paddingVertical: 14,
		alignItems: 'center',
		backgroundColor: lightPalette.primary.main,
	},
	primaryButtonText: {
		fontSize: mobileTypography.button.fontSize,
		fontWeight: '700',
		lineHeight: mobileTypography.button.lineHeight,
		color: lightPalette.primary.contrastText,
	},
	secondaryButton: {
		borderRadius: radius.lg,
		paddingVertical: 14,
		alignItems: 'center',
		borderWidth: border.hairline,
		borderColor: lightPalette.divider,
	},
	secondaryButtonText: {
		fontSize: mobileTypography.button.fontSize,
		fontWeight: '600',
		lineHeight: mobileTypography.button.lineHeight,
		color: lightPalette.text.primary,
	},
});