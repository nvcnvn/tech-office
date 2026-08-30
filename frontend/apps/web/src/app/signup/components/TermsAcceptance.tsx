'use client';

import Link from 'next/link';
import { Checkbox, FormControl, FormControlLabel, FormHelperText, Typography } from '@mui/material';
import type { FieldErrors, UseFormRegister } from 'react-hook-form';
import { PRIVACY_POLICY_PATH, TERMS_PATH } from 'apis';

import type { SignupFormData } from '@tech-office/validations';

/**
 * Terms acknowledgement for the signup screen (Feature 036, FR-010).
 *
 * Both documents are linked, and both open in a new tab, so reading them does not
 * discard a half-filled form. The checkbox is unticked by default and the schema
 * requires it to be `true`, so submitting without ticking it fails validation and
 * surfaces the message below — an account cannot be created without an explicit
 * acknowledgement.
 */
export function TermsAcceptance({
	register,
	errors,
}: {
	register: UseFormRegister<SignupFormData>;
	errors: FieldErrors<SignupFormData>;
}) {
	const error = errors.acceptedTerms;

	return (
		<FormControl error={Boolean(error)} sx={{ mt: 2, display: 'block' }}>
			<FormControlLabel
				control={
					<Checkbox
						{...register('acceptedTerms')}
						size="small"
						sx={{ pt: 0.25 }}
					/>
				}
				sx={{ alignItems: 'flex-start', m: 0 }}
				label={
					<Typography variant="body2" color="text.secondary">
						I have read and agree to the{' '}
						<Link href={TERMS_PATH} target="_blank" rel="noopener noreferrer">
							terms of service
						</Link>{' '}
						and the{' '}
						<Link href={PRIVACY_POLICY_PATH} target="_blank" rel="noopener noreferrer">
							privacy policy
						</Link>
						.
					</Typography>
				}
			/>
			{error && <FormHelperText sx={{ ml: 0 }}>{error.message}</FormHelperText>}
		</FormControl>
	);
}
