import { Metadata } from 'next';
import { SignupForm } from './components/SignupForm';

export const metadata: Metadata = {
	title: 'Sign Up | Tech Office',
	description: 'Create your organization account and get started with Tech Office',
};

/**
 * Signup page - Public route for organization registration
 */
export default function SignupPage() {
	return <SignupForm />;
}
