/**
 * Batch Presence Display Component
 * Efficiently displays presence for multiple employees
 * Constitution v5.4.0 compliant
 */

'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { getBatchEmployeePresence, type PresenceStatus, type EmployeePresence } from 'apis';

interface BatchPresenceDisplayProps {
	/** Array of employee IDs to fetch presence for */
	employeeIds: string[];
	/** Render function for each employee's presence */
	children: (employeeId: string, presence: EmployeePresence | null) => React.ReactNode;
	/** Refresh interval in milliseconds (default: 60s) */
	refreshInterval?: number;
}

/**
 * Batch presence display component for employee lists
 * 
 * Features:
 * - Batch API calls to avoid N+1 queries
 * - Real-time updates via SSE
 * - Automatic refresh
 * - Render prop pattern for flexibility
 * 
 * @example
 * ```tsx
 * <BatchPresenceDisplay employeeIds={['id1', 'id2']}>
 *   {(employeeId, presence) => (
 *     <div>
 *       {presence?.status || 'unknown'}
 *     </div>
 *   )}
 * </BatchPresenceDisplay>
 * ```
 */
export default function BatchPresenceDisplay({
	employeeIds,
	children,
	refreshInterval = 60000,
}: BatchPresenceDisplayProps) {
	const [presenceMap, setPresenceMap] = useState<Map<string, EmployeePresence>>(new Map());
	const [isLoading, setIsLoading] = useState(true);

	// Fetch batch presence
	const fetchPresence = useMemo(() => async () => {
		if (employeeIds.length === 0) {
			setPresenceMap(new Map());
			setIsLoading(false);
			return;
		}

		try {
			const map = await getBatchEmployeePresence(employeeIds);
			setPresenceMap(map);
		} catch (err) {
			console.error('[BatchPresenceDisplay] Failed to fetch presence:', err);
		} finally {
			setIsLoading(false);
		}
	}, [employeeIds]);

	// Initial fetch
	useEffect(() => {
		fetchPresence();
	}, [fetchPresence]);

	// Periodic refresh
	useEffect(() => {
		if (refreshInterval <= 0) return;

		const interval = setInterval(fetchPresence, refreshInterval);

		return () => clearInterval(interval);
	}, [fetchPresence, refreshInterval]);

	// Listen for real-time presence updates via SSE
	useEffect(() => {
		const handlePresenceUpdate = (event: CustomEvent) => {
			const {
				employeeId,
				status,
				activeChannelId,
				lastInteractionAt,
				lastHeartbeat,
				visibility
			} = event.detail;

			// Only update if this employee is in our list
			if (employeeIds.includes(employeeId)) {
				setPresenceMap(prev => {
					const newMap = new Map(prev);
					newMap.set(employeeId, {
						employeeId,
						status: status as PresenceStatus,
						activeChannelId,
						lastInteractionAt: new Date(lastInteractionAt),
						lastHeartbeat: new Date(lastHeartbeat),
						visibility,
					});
					return newMap;
				});
			}
		};

		window.addEventListener('presence-update', handlePresenceUpdate as EventListener);

		return () => {
			window.removeEventListener('presence-update', handlePresenceUpdate as EventListener);
		};
	}, [employeeIds]);

	// Listen for batch presence updates
	useEffect(() => {
		const handleBatchUpdate = (event: CustomEvent) => {
			const { presences } = event.detail;

			if (Array.isArray(presences)) {
				setPresenceMap(prev => {
					const newMap = new Map(prev);
					presences.forEach((p: EmployeePresence) => {
						if (employeeIds.includes(p.employeeId)) {
							newMap.set(p.employeeId, p);
						}
					});
					return newMap;
				});
			}
		};

		window.addEventListener('batch-presence-update', handleBatchUpdate as EventListener);

		return () => {
			window.removeEventListener('batch-presence-update', handleBatchUpdate as EventListener);
		};
	}, [employeeIds]);

	if (isLoading && presenceMap.size === 0) {
		return null; // Or loading skeleton
	}

	return (
		<>
			{employeeIds.map(employeeId => (
				<React.Fragment key={employeeId}>
					{children(employeeId, presenceMap.get(employeeId) || null)}
				</React.Fragment>
			))}
		</>
	);
}

/**
 * Hook version for use in custom components
 */
export function useBatchPresence(employeeIds: string[], refreshInterval = 60000) {
	const [presenceMap, setPresenceMap] = useState<Map<string, EmployeePresence>>(new Map());
	const [isLoading, setIsLoading] = useState(true);

	// Fetch batch presence
	useEffect(() => {
		let mounted = true;

		const fetchPresence = async () => {
			if (employeeIds.length === 0) {
				setPresenceMap(new Map());
				setIsLoading(false);
				return;
			}

			try {
				const map = await getBatchEmployeePresence(employeeIds);
				if (mounted) {
					setPresenceMap(map);
				}
			} catch (err) {
				console.error('[useBatchPresence] Failed to fetch presence:', err);
			} finally {
				if (mounted) {
					setIsLoading(false);
				}
			}
		};

		fetchPresence();

		// Periodic refresh
		if (refreshInterval > 0) {
			const interval = setInterval(fetchPresence, refreshInterval);
			return () => {
				mounted = false;
				clearInterval(interval);
			};
		}

		return () => {
			mounted = false;
		};
	}, [employeeIds, refreshInterval]);

	// Listen for real-time updates
	useEffect(() => {
		const handlePresenceUpdate = (event: CustomEvent) => {
			const { employeeId, status, activeChannelId, lastInteractionAt, lastHeartbeat, visibility } = event.detail;

			if (employeeIds.includes(employeeId)) {
				setPresenceMap(prev => {
					const newMap = new Map(prev);
					newMap.set(employeeId, {
						employeeId,
						status: status as PresenceStatus,
						activeChannelId,
						lastInteractionAt: new Date(lastInteractionAt),
						lastHeartbeat: new Date(lastHeartbeat),
						visibility,
					});
					return newMap;
				});
			}
		};

		window.addEventListener('presence-update', handlePresenceUpdate as EventListener);

		return () => {
			window.removeEventListener('presence-update', handlePresenceUpdate as EventListener);
		};
	}, [employeeIds]);

	return { presenceMap, isLoading };
}
