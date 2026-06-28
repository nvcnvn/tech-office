'use client';

import { TextField, Stack, InputAdornment } from '@mui/material';
import { UseFormRegister, FieldErrors } from 'react-hook-form';
import { SignupFormData } from '../../../lib/validations/signup';
import { SubdomainCheck } from './SubdomainCheck';

interface OrganizationFieldsProps {
	register: UseFormRegister<SignupFormData>;
	errors: FieldErrors<SignupFormData>;
	subdomainValue: string;
}

/**
 * Company name and subdomain input fields
 */
export function OrganizationFields({
	register,
	errors,
	subdomainValue,
}: OrganizationFieldsProps) {
	return (
		<Stack spacing={2}>
			<TextField
				{...register('companyName')}
				label="Company Name"
				fullWidth
				required
				error={!!errors.companyName}
				helperText={errors.companyName?.message}
				autoComplete="organization"
			/>
			<TextField
				{...register('subdomain')}
				label="Subdomain"
				fullWidth
				required
				error={!!errors.subdomain}
				helperText={errors.subdomain?.message || 'Your organization URL: [subdomain].tech-office.com'}
				autoComplete="off"
				InputProps={{
					endAdornment: (
						<InputAdornment position="end">
							<SubdomainCheck subdomain={subdomainValue} />
						</InputAdornment>
					),
				}}
			/>
		</Stack>
	);
}
