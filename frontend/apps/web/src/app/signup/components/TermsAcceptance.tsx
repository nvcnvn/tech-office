'use client';

import Link from 'next/link';
import { Checkbox, FormControl, FormControlLabel, FormHelperText, Typography } from '@mui/material';
import type { FieldErrors, UseFormRegister, UseFormTrigger } from 'react-hook-form';
import { PRIVACY_POLICY_PATH, TERMS_PATH } from 'apis';

import type { SignupFormData } from '../../../lib/validations/signup';

/**
 * Terms acknowledgement for the signup screen (Feature 036, FR-010).
 *
 * Both documents are linked, and both open in a new tab, so reading them does not
 * discard a half-filled form. The checkbox is unticked by default and the schema
 * requires it to be `true`, which is what keeps the submit button disabled — an
 * account cannot be created without an explicit acknowledgement.
 */
export function TermsAcceptance({
	register,
	errors,
	trigger,
}: {
	register: UseFormRegister<SignupFormData>;
	errors: FieldErrors<SignupFormData>;
	trigger: UseFormTrigger<SignupFormData>;
}) {
	const error = errors.acceptedTerms;

	return (
		<FormControl error={Boolean(error)} sx={{ mt: 2, display: 'block' }}>
			<FormControlLabel
				control={
					<Checkbox
						{...register('acceptedTerms')}
						// The form validates on blur, and a checkbox is clicked rather
						// than tabbed through — without this, ticking the box left the
						// submit button disabled until the person happened to click
						// somewhere else, which reads as the box not having worked.
						onChange={(event) => {
							void register('acceptedTerms').onChange(event);
							void trigger('acceptedTerms');
						}}
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
