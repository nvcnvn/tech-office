import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getAuthToken } from "apis";

import { setPendingPostSignInRedirect } from "@/lib/auth-redirect-handoff";
import { getCanonicalInAppRoute } from "@/lib/canonical-links";
import { buildWebUrl } from "@/lib/constants";

const CANONICAL_QUERY_KEYS = ["focusIntent", "entryContext", "requirementId", "anchorType", "anchorId"] as const;

function firstParam(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

export default function CanonicalResourceRoute() {
	const router = useRouter();
	const params = useLocalSearchParams<{
		tenantKey?: string | string[];
		resourceType?: string | string[];
		resourceId?: string | string[];
		focusIntent?: string | string[];
		entryContext?: string | string[];
		requirementId?: string | string[];
		anchorType?: string | string[];
		anchorId?: string | string[];
	}>();

	useEffect(() => {
		let cancelled = false;

		async function routeCanonicalResource() {
			const tenantKey = firstParam(params.tenantKey);
			const resourceType = firstParam(params.resourceType);
			const resourceId = firstParam(params.resourceId);
			if (!tenantKey || !resourceType || !resourceId) {
				router.replace("/(auth)");
				return;
			}

			const query = new URLSearchParams();
			for (const key of CANONICAL_QUERY_KEYS) {
				const value = firstParam(params[key]);
				if (value) {
					query.set(key, value);
				}
			}

			const path = `/o/${tenantKey}/r/${resourceType}/${resourceId}`;
			const raw = buildWebUrl(`${path}${query.size > 0 ? `?${query.toString()}` : ""}`);
			const token = await getAuthToken();
			if (!token) {
				setPendingPostSignInRedirect(raw, tenantKey);
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

		void routeCanonicalResource();

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