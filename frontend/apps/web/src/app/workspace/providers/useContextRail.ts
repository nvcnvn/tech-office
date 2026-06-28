'use client';

import { useContext, useEffect } from 'react';

import {
	ContextRailContext,
	type ContextRailContextValue,
	type ContextRailRegistration,
} from './ContextRailProvider';

export function useContextRail(): ContextRailContextValue {
	const context = useContext(ContextRailContext);

	if (!context) {
		throw new Error('useContextRail must be used within a ContextRailProvider');
	}

	return context;
}

export function useRegisterContextRail(registration: ContextRailRegistration | null) {
	const { registerPageRegistration, unregisterPageRegistration } = useContextRail();

	useEffect(() => {
		if (!registration) {
			return undefined;
		}

		registerPageRegistration(registration);

		return () => {
			unregisterPageRegistration(registration.registrationToken);
		};
	}, [registration, registerPageRegistration, unregisterPageRegistration]);
}

export function createContextRailRegistrationToken(prefix = 'context-rail') {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return `${prefix}-${crypto.randomUUID()}`;
	}

	return `${prefix}-${Date.now()}`;
}