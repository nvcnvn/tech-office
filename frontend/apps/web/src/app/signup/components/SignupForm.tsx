'use client';

import { Box, Button, Container, Typography, Paper, CircularProgress, Divider } from '@mui/material';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSignupForm } from '../../../lib/hooks/useSignupForm';
import { OrganizationFields } from './OrganizationFields';
import { AdminFields } from './AdminFields';
import { SignupError } from './SignupError';
import { SignupSuccess } from './SignupSuccess';

/**
 * Main signup form component
 * Composing all subcomponents and handling form submission
 */
export function SignupForm() {
	const router = useRouter();
	const {
		register,
		handleSubmit,
		formState,
		watch,
		isSubmitting,
		submitError,
		submitSuccess,
		onSubmit,
	} = useSignupForm();

	const subdomainValue = watch('subdomain');
	const passwordValue = watch('adminPassword');
	const companyName = watch('companyName');

	// Redirect to signin after successful registration
	useEffect(() => {
		if (submitSuccess) {
			const timer = setTimeout(() => {
				router.push('/signin');
			}, 3000);
			return () => clearTimeout(timer);
		}
	}, [submitSuccess, router]);

	return (
		<Container maxWidth="sm" sx={{ py: 8 }}>
			<Paper elevation={0} sx={{ p: 4 }}>
				<Typography variant="h4" component="h1" gutterBottom align="center">
					Create Your Organization
				</Typography>
				<Typography variant="body2" color="text.secondary" align="center" sx={{ mb: 4 }}>
					Get started with Tech Office - your all-in-one business management platform
				</Typography>

				{submitSuccess && <SignupSuccess organizationName={companyName} />}
				{submitError && <SignupError error={submitError} />}

				{!submitSuccess && (
					<Box
						component="form"
						onSubmit={handleSubmit(onSubmit)}
						noValidate
						sx={{ mt: 2 }}
					>
						<Typography variant="h6" gutterBottom>
							Organization Details
						</Typography>
						<OrganizationFields
							register={register}
							errors={formState.errors}
							subdomainValue={subdomainValue}
						/>

						<Divider sx={{ my: 3 }} />

						<Typography variant="h6" gutterBottom>
							Admin Account
						</Typography>
						<AdminFields
							register={register}
							errors={formState.errors}
							passwordValue={passwordValue}
						/>

						<Button
							type="submit"
							fullWidth
							variant="contained"
							size="large"
							disabled={isSubmitting || !formState.isValid}
							sx={{ mt: 3 }}
							startIcon={isSubmitting ? <CircularProgress size={20} /> : null}
						>
							{isSubmitting ? 'Creating Organization...' : 'Create Organization'}
						</Button>

						<Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 2 }}>
							Already have an account?{' '}
							<Button
								variant="text"
								size="small"
								onClick={() => router.push('/signin')}
								disabled={isSubmitting}
							>
								Sign In
							</Button>
						</Typography>
					</Box>
				)}
			</Paper>
		</Container>
	);
}
