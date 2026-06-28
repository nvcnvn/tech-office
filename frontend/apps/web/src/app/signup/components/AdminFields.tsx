'use client';

import { TextField, Stack, IconButton, InputAdornment } from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { useState } from 'react';
import { UseFormRegister, FieldErrors } from 'react-hook-form';
import { SignupFormData } from '../../../lib/validations/signup';
import { PasswordStrength } from './PasswordStrength';

interface AdminFieldsProps {
	register: UseFormRegister<SignupFormData>;
	errors: FieldErrors<SignupFormData>;
	passwordValue: string;
}

/**
 * Admin user credential input fields
 */
export function AdminFields({
	register,
	errors,
	passwordValue,
}: AdminFieldsProps) {
	const [showPassword, setShowPassword] = useState(false);

	const handleTogglePasswordVisibility = () => {
		setShowPassword(!showPassword);
	};

	return (
		<Stack spacing={2}>
			<TextField
				{...register('adminEmail')}
				label="Admin Email"
				type="email"
				fullWidth
				required
				error={!!errors.adminEmail}
				helperText={errors.adminEmail?.message}
				autoComplete="email"
			/>
			<div>
				<TextField
					{...register('adminPassword')}
					label="Password"
					type={showPassword ? 'text' : 'password'}
					fullWidth
					required
					error={!!errors.adminPassword}
					helperText={errors.adminPassword?.message}
					autoComplete="new-password"
					InputProps={{
						endAdornment: (
							<InputAdornment position="end">
								<IconButton
									aria-label={showPassword ? 'Hide password' : 'Show password'}
									onClick={handleTogglePasswordVisibility}
									edge="end"
								>
									{showPassword ? <VisibilityOff /> : <Visibility />}
								</IconButton>
							</InputAdornment>
						),
					}}
				/>
				<PasswordStrength password={passwordValue} />
			</div>
			<TextField
				{...register('adminGivenName')}
				label="First Name"
				fullWidth
				required
				error={!!errors.adminGivenName}
				helperText={errors.adminGivenName?.message}
				autoComplete="given-name"
			/>
			<TextField
				{...register('adminFamilyName')}
				label="Last Name"
				fullWidth
				required
				error={!!errors.adminFamilyName}
				helperText={errors.adminFamilyName?.message}
				autoComplete="family-name"
			/>
		</Stack>
	);
}
