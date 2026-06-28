'use client';

import type { PropsWithChildren, ReactNode } from 'react';
import {
	createContext,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import useMediaQuery from '@mui/material/useMediaQuery';
import { usePathname } from 'next/navigation';

export const CONTEXT_RAIL_PREFERENCE_KEY = 'contextRail.preference';
export const CONTEXT_RAIL_AUTO_COLLAPSE_QUERY = '(max-width: 1023px)';

export type ContextRailManualState = 'open' | 'closed';

export interface ContextRailBlockRegistration {
	id: string;
	node: ReactNode;
	priority?: number;
}

export interface ContextRailRegistration {
	routeKey: string;
	registrationToken: string;
	blocks: ContextRailBlockRegistration[];
	showGlobalBlocks?: boolean;
	contextPayload?: unknown;
	expiresOnRouteChange?: boolean;
	updatedAt?: number;
}

export interface ContextRailContextValue {
	activeRouteKey: string;
	hasBadgeAlert: boolean;
	isAutoCollapsed: boolean;
	isOpen: boolean;
	lastManualState: ContextRailManualState;
	pageRegistration: ContextRailRegistration | null;
	setHasBadgeAlert: (value: boolean) => void;
	openRail: () => void;
	closeRail: () => void;
	toggleRail: () => void;
	registerPageRegistration: (registration: ContextRailRegistration) => void;
	unregisterPageRegistration: (registrationToken: string) => void;
	clearPageRegistration: () => void;
	setManualState: (value: ContextRailManualState) => void;
}

export const ContextRailContext = createContext<ContextRailContextValue | undefined>(undefined);

export function ContextRailProvider({ children }: PropsWithChildren) {
	const pathname = usePathname();
	const activeRouteKey = useMemo(() => getWorkspaceRouteKey(pathname), [pathname]);
	const isNarrowViewport = useMediaQuery(CONTEXT_RAIL_AUTO_COLLAPSE_QUERY);
	const previousNarrowViewportRef = useRef<boolean | null>(null);
	const [hasHydratedPreference, setHasHydratedPreference] = useState(false);
	const [hasBadgeAlert, setHasBadgeAlert] = useState(false);
	const [isAutoCollapsed, setIsAutoCollapsed] = useState(false);
	const [isOpen, setIsOpen] = useState(true);
	const [lastManualState, setLastManualState] = useState<ContextRailManualState>('open');
	const [pageRegistration, setPageRegistration] = useState<ContextRailRegistration | null>(null);

	useEffect(() => {
		try {
			const savedPreference = window.sessionStorage.getItem(CONTEXT_RAIL_PREFERENCE_KEY);
			if (savedPreference === 'closed') {
				setLastManualState('closed');
				setIsOpen(false);
				return;
			}

			setLastManualState('open');
			setIsOpen(true);
		} catch {
			setLastManualState('open');
			setIsOpen(true);
		} finally {
			setHasHydratedPreference(true);
		}
	}, []);

	useEffect(() => {
		if (!hasHydratedPreference) {
			return;
		}

		try {
			window.sessionStorage.setItem(CONTEXT_RAIL_PREFERENCE_KEY, lastManualState);
		} catch {
			// Ignore storage failures and keep the in-memory preference.
		}
	}, [hasHydratedPreference, lastManualState]);

	useEffect(() => {
		const previousNarrowViewport = previousNarrowViewportRef.current;

		if (previousNarrowViewport === null) {
			previousNarrowViewportRef.current = isNarrowViewport;
			setIsAutoCollapsed(isNarrowViewport);
			if (isNarrowViewport) {
				setIsOpen(false);
			}
			return;
		}

		if (previousNarrowViewport === isNarrowViewport) {
			return;
		}

		previousNarrowViewportRef.current = isNarrowViewport;
		setIsAutoCollapsed(isNarrowViewport);

		if (isNarrowViewport) {
			setIsOpen(false);
			return;
		}

		setIsOpen(lastManualState === 'open');
	}, [isNarrowViewport, lastManualState]);

	useEffect(() => {
		setPageRegistration((currentRegistration) => {
			if (!currentRegistration) {
				return currentRegistration;
			}

			if (currentRegistration.routeKey === activeRouteKey) {
				return currentRegistration;
			}

			if (currentRegistration.expiresOnRouteChange === false) {
				return currentRegistration;
			}

			return null;
		});
	}, [activeRouteKey]);

	const setManualState = useCallback((value: ContextRailManualState) => {
		setLastManualState(value);
		setIsOpen(value === 'open');
	}, []);

	const openRail = useCallback(() => {
		setManualState('open');
	}, [setManualState]);

	const closeRail = useCallback(() => {
		setManualState('closed');
	}, [setManualState]);

	const toggleRail = useCallback(() => {
		setLastManualState((currentManualState) => {
			const nextManualState = currentManualState === 'open' ? 'closed' : 'open';
			setIsOpen(nextManualState === 'open');
			return nextManualState;
		});
	}, []);

	const clearPageRegistration = useCallback(() => {
		setPageRegistration(null);
	}, []);

	const registerPageRegistration = useCallback(
		(registration: ContextRailRegistration) => {
			setPageRegistration((currentRegistration) => {
				if (registration.routeKey !== activeRouteKey) {
					return currentRegistration;
				}

				return {
					...registration,
					blocks: [...registration.blocks].sort(
						(leftBlock, rightBlock) => (leftBlock.priority ?? 0) - (rightBlock.priority ?? 0)
					),
					updatedAt: Date.now(),
				};
			});
		},
		[activeRouteKey]
	);

	const unregisterPageRegistration = useCallback((registrationToken: string) => {
		setPageRegistration((currentRegistration) => {
			if (!currentRegistration) {
				return currentRegistration;
			}

			if (currentRegistration.registrationToken !== registrationToken) {
				return currentRegistration;
			}

			return null;
		});
	}, []);

	const contextValue = useMemo<ContextRailContextValue>(
		() => ({
			activeRouteKey,
			hasBadgeAlert,
			isAutoCollapsed,
			isOpen,
			lastManualState,
			pageRegistration:
				pageRegistration?.routeKey === activeRouteKey ? pageRegistration : null,
			setHasBadgeAlert,
			openRail,
			closeRail,
			toggleRail,
			registerPageRegistration,
			unregisterPageRegistration,
			clearPageRegistration,
			setManualState,
		}),
		[
			activeRouteKey,
			hasBadgeAlert,
			isAutoCollapsed,
			isOpen,
			lastManualState,
			pageRegistration,
			openRail,
			closeRail,
			toggleRail,
			registerPageRegistration,
			unregisterPageRegistration,
			clearPageRegistration,
			setManualState,
		]
	);

	return <ContextRailContext.Provider value={contextValue}>{children}</ContextRailContext.Provider>;
}

function getWorkspaceRouteKey(pathname: string | null): string {
	if (!pathname) {
		return 'workspace';
	}

	const pathnameSegments = pathname.split('/').filter(Boolean);
	return pathnameSegments[1] ?? 'workspace';
}