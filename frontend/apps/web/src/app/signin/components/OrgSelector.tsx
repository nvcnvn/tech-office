'use client';

// T028: OrgSelector Component
// Extracts organization subdomain from hostname or query params and validates it

import { useState, useEffect, useCallback } from 'react';
import {
	TextField,
	Alert,
	CircularProgress,
	Box,
	Typography,
} from '@mui/material';
import { getOrganizationBySubdomain, Organization } from 'apis';
import { extractOrganization } from '../../config/auth';

export interface OrgSelectorProps {
	/** Initial subdomain value (optional) */
	initialSubdomain?: string;
	/** Callback when organization is successfully validated */
	onChange: (orgId: string, organization: Organization) => void;
	/** Optional error override */
	error?: string;
}

/**
 * OrgSelector Component
 * 
 * Automatically extracts and validates organization subdomain from:
 * 1. Hostname subdomain (e.g., acme.tech-office.com)
 * 2. Query parameter ?org=acme
 * 3. Manual input (if neither above is present)
 * 
 * Calls backend API to validate subdomain and returns organization details
 */
export function OrgSelector({ initialSubdomain, onChange, error: externalError }: OrgSelectorProps) {
	const [subdomain, setSubdomain] = useState<string>('');
	const [organization, setOrganization] = useState<Organization | null>(null);
	const [loading, setLoading] = useState<boolean>(false);
	const [error, setError] = useState<string>('');
	const [autoValidated, setAutoValidated] = useState<boolean>(false);

	/**
	 * Validate subdomain with backend API
	 */
	const validateSubdomain = useCallback(async (sub: string) => {
		if (!sub || sub.trim() === '') {
			setError('Please enter an organization subdomain');
			setOrganization(null);
			return;
		}

		setLoading(true);
		setError('');

		try {
			const org = await getOrganizationBySubdomain(sub.trim());
			setOrganization(org);
			setError('');
			setAutoValidated(true);

			// Notify parent component
			onChange(org.id, org);
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : 'Failed to validate organization';
			setError(errorMessage);
			setOrganization(null);
		} finally {
			setLoading(false);
		}
	}, [onChange]);

	// Extract subdomain from URL on mount
	useEffect(() => {
		if (typeof window === 'undefined') return;

		// Priority: initialSubdomain prop > URL extraction
		if (initialSubdomain) {
			setSubdomain(initialSubdomain);
			validateSubdomain(initialSubdomain);
			return;
		}

		// Extract from hostname or query params
		const searchParams = new URLSearchParams(window.location.search);
		const extractedSubdomain = extractOrganization(
			window.location.hostname,
			searchParams
		);

		if (extractedSubdomain) {
			setSubdomain(extractedSubdomain);
			validateSubdomain(extractedSubdomain);
		}
	}, [initialSubdomain, validateSubdomain]);

	/**
	 * Handle manual subdomain change
	 */
	const handleSubdomainChange = (value: string) => {
		setSubdomain(value);
		setAutoValidated(false);

		// Clear error and org when user starts typing
		if (error) setError('');
		if (organization) setOrganization(null);
	};

	/**
	 * Handle manual validation (blur or enter key)
	 */
	const handleValidate = () => {
		if (!autoValidated && subdomain) {
			validateSubdomain(subdomain);
		}
	};

	// Use external error if provided
	const displayError = externalError || error;

	return (
		<Box sx={{ width: '100%', maxWidth: 400 }}>
			<TextField
				fullWidth
				label="Organization Subdomain"
				placeholder="e.g., acme"
				value={subdomain}
				onChange={(e) => handleSubdomainChange(e.target.value)}
				onBlur={handleValidate}
				onKeyPress={(e) => {
					if (e.key === 'Enter') {
						handleValidate();
					}
				}}
				error={!!displayError}
				helperText={displayError || 'Enter your organization subdomain'}
				disabled={loading}
				InputProps={{
					endAdornment: loading ? (
						<CircularProgress size={20} />
					) : null,
				}}
			/>

			{organization && !displayError && (
				<Alert severity="success" sx={{ mt: 2 }}>
					<Typography variant="body2">
						<strong>{organization.companyName}</strong>
					</Typography>
					<Typography variant="caption" color="text.secondary">
						Subdomain: {organization.subdomain}
					</Typography>
				</Alert>
			)}

			{displayError && (
				<Alert severity="error" sx={{ mt: 2 }}>
					{displayError}
				</Alert>
			)}
		</Box>
	);
}
