'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { signupFormSchema, SignupFormData } from '@tech-office/validations';
import { registerOrganization, TERMS_VERSION } from 'apis';
import { useState } from 'react';

interface UseSignupFormResult {
	register: ReturnType<typeof useForm<SignupFormData>>['register'];
	handleSubmit: ReturnType<typeof useForm<SignupFormData>>['handleSubmit'];
	formState: ReturnType<typeof useForm<SignupFormData>>['formState'];
	watch: ReturnType<typeof useForm<SignupFormData>>['watch'];
	isSubmitting: boolean;
	submitError: Error | null;
	submitSuccess: boolean;
	onSubmit: (data: SignupFormData) => Promise<void>;
}

/**
 * Hook for managing signup form state with React Hook Form + Zod validation
 * @returns Form methods and state
 */
export function useSignupForm(): UseSignupFormResult {
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<Error | null>(null);
	const [submitSuccess, setSubmitSuccess] = useState(false);

	const {
		register,
		handleSubmit,
		formState,
		watch,
	} = useForm<SignupFormData>({
		resolver: zodResolver(signupFormSchema),
		mode: 'onBlur', // Validate on blur for better UX
		defaultValues: {
			companyName: '',
			subdomain: '',
			adminEmail: '',
			adminPassword: '',
			adminGivenName: '',
			adminFamilyName: '',
			acceptedTerms: undefined,
		},
	});

	const onSubmit = async (data: SignupFormData) => {
		setIsSubmitting(true);
		setSubmitError(null);
		setSubmitSuccess(false);

		try {
			await registerOrganization({
				companyName: data.companyName,
				subdomain: data.subdomain,
				adminEmail: data.adminEmail,
				adminPassword: data.adminPassword,
				adminGivenName: data.adminGivenName,
				adminFamilyName: data.adminFamilyName,
				// The schema requires acceptedTerms to be literally true, so reaching
				// here means the person ticked the box on this screen.
				acceptedTermsVersion: TERMS_VERSION,
			});
			setSubmitSuccess(true);
		} catch (err) {
			setSubmitError(err instanceof Error ? err : new Error('Registration failed'));
		} finally {
			setIsSubmitting(false);
		}
	};

	return {
		register,
		handleSubmit,
		formState,
		watch,
		isSubmitting,
		submitError,
		submitSuccess,
		onSubmit,
	};
}
