import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { parseCanonicalResourceLink } from "@tech-office/links";
import { getAuthToken } from "apis";

import { setPendingPostSignInRedirect } from "@/lib/auth-redirect-handoff";
import { getCanonicalInAppRoute } from "@/lib/canonical-links";
import { buildWebUrl } from "@/lib/constants";

const CANONICAL_QUERY_KEYS = ["focusIntent", "entryContext", "requirementId", "anchorType", "anchorId"] as const;

function firstParam(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

export default function CanonicalCatchAllRoute() {
	const router = useRouter();
	const params = useLocalSearchParams<{
		path?: string | string[];
		focusIntent?: string | string[];
		entryContext?: string | string[];
		requirementId?: string | string[];
		anchorType?: string | string[];
		anchorId?: string | string[];
	}>();

	useEffect(() => {
		let cancelled = false;

		async function routePath() {
			const segments = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
			const path = `/${segments.filter(Boolean).join("/")}`;
			const query = new URLSearchParams();
			for (const key of CANONICAL_QUERY_KEYS) {
				const value = firstParam(params[key]);
				if (value) {
					query.set(key, value);
				}
			}

			const raw = buildWebUrl(`${path}${query.size > 0 ? `?${query.toString()}` : ""}`);
			const target = parseCanonicalResourceLink(raw);
			if (!target) {
				router.replace("/(auth)");
				return;
			}

			const token = await getAuthToken();
			if (!token) {
				setPendingPostSignInRedirect(raw, target.tenantKey);
				if (!cancelled) {
					router.replace("/canonical-signin");
				}
				return;
			}

			const resolved = (await getCanonicalInAppRoute(raw)) ?? "/(app)/(chat)";
			if (!cancelled) {
				router.replace(resolved);
			}
		}

		void routePath();

		return () => {
			cancelled = true;
		};
	}, [params, router]);

	return (
		<View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
			<ActivityIndicator size="large" />
		</View>
	);
}