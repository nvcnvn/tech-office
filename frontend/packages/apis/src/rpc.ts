/**
 * RPC transport configuration
 *
 * Uses the platform adapter's TransportFactory when configured (mobile),
 * falling back to @connectrpc/connect-web for web.
 *
 * A thin "proxy transport" is used so that clients can be created once at
 * module-load time, while the actual transport is resolved lazily on first
 * use — after the platform adapter has been configured. (T0.14)
 */

import { Interceptor, createClient, type Transport } from "@connectrpc/connect";
import { getAuthToken } from "./token";
import { hasPlatform, getPlatform } from "./platform";
import { iam, organizations, department, notification, chat, preference, files, chat_files, document, collaboration, calendar, voice, compliance, tour } from "rpc";

declare const require: ((id: string) => unknown) | undefined;

// Authentication interceptor to attach the JWT access token to all requests
const authInterceptor: Interceptor = (next) => async (req) => {
	try {
		const token = await getAuthToken();
		if (token) {
			req.header.set("Authorization", `Bearer ${token}`);
		}
	} catch (error) {
		console.error('[Auth Interceptor] Error adding auth token to request:', error);
	}
	return await next(req);
};

// Configuration for the RPC clients
let _baseUrl = "http://localhost:18080/";
let _transport: Transport | null = null;

/**
 * Configure the RPC base URL. Should be called once during app initialization.
 * @param baseUrl - The base URL for the RPC server (e.g., process.env.NEXT_PUBLIC_API_URL)
 */
export function configureRPC(baseUrl: string) {
	_baseUrl = baseUrl;
	_transport = null; // Reset transport to recreate with new baseUrl
}

export function getRPCBaseUrl(): string {
	return _baseUrl;
}

/** Resolves and caches the real transport (platform-injected or web fallback) */
function getTransport(): Transport {
	if (!_transport) {
		if (hasPlatform()) {
			// Mobile (or any platform with an injected adapter): use the factory.
			// Note: the factory's interceptor handles auth, so we don't add authInterceptor.
			_transport = getPlatform().transport.createTransport(
				_baseUrl,
				() => getAuthToken(),
			);
		} else {
			// Web fallback: require lazily so RN bundlers don't pull in connect-web
			// when a platform adapter is registered.
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			if (!require) {
				throw new Error("[rpc] connect-web loader unavailable without a configured platform adapter.");
			}
			const { createConnectTransport } = require(
				"@connectrpc/connect-web",
			) as typeof import("@connectrpc/connect-web");
			_transport = createConnectTransport({
				baseUrl: _baseUrl,
				interceptors: [authInterceptor],
				useBinaryFormat: false,
				jsonOptions: { ignoreUnknownFields: true },
			});
		}
	}
	return _transport!;
}

/**
 * A proxy transport that delegates to the resolved transport on every call.
 * This allows clients to be created at module-load time while the real
 * transport (and base URL) can still be swapped via configureRPC() /
 * configurePlatform() before the first actual RPC call.
 */
const proxyTransport: Transport = {
	unary: ((...args: unknown[]) =>
		(getTransport().unary as (...innerArgs: unknown[]) => unknown)(...args)) as Transport["unary"],
	stream: ((...args: unknown[]) =>
		(getTransport().stream as (...innerArgs: unknown[]) => unknown)(...args)) as Transport["stream"],
};

// Create clients that use the lazy proxy transport
export const iamClient = createClient(iam.IAMService, proxyTransport);
export const organizationClient = createClient(organizations.OrganizationService, proxyTransport);
export const departmentClient = createClient(department.DepartmentService, proxyTransport);
export const notificationClient = createClient(notification.NotificationService, proxyTransport);
export const chatClient = createClient(chat.ChatService, proxyTransport);
export const preferenceClient = createClient(preference.PreferenceService, proxyTransport);
export const fileClient = createClient(files.FileService, proxyTransport);
export const chatFileClient = createClient(chat_files.ChatFileService, proxyTransport);

// Document Management System clients
export const documentClient = createClient(document.DocumentService, proxyTransport);
export const documentVersionClient = createClient(document.DocumentVersionService, proxyTransport);
export const documentAccessClient = createClient(document.DocumentAccessService, proxyTransport);
export const documentFollowerClient = createClient(document.DocumentFollowerService, proxyTransport);
export const commentClient = createClient(document.CommentService, proxyTransport);
export const documentReactionClient = createClient(document.DocumentReactionService, proxyTransport);
export const sectionEmbedClient = createClient(document.SectionEmbedService, proxyTransport);
export const documentEditorClient = createClient(document.DocumentEditorService, proxyTransport);

// Task Collaboration System client
export const collaborationClient = createClient(collaboration.CollaborationService, proxyTransport);

// Calendar System client
export const calendarClient = createClient(calendar.CalendarService, proxyTransport);

// Voice Communication client
export const voiceClient = createClient(voice.VoiceService, proxyTransport);

// Compliance client (Feature 036: reporting, blocking, removal requests)
export const complianceClient = createClient(compliance.ComplianceService, proxyTransport);

// Feature tour client (Feature 039: server-driven orientation tours)
export const tourClient = createClient(tour.TourService, proxyTransport);
