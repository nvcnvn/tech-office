import type { Metadata } from 'next';

import { GuideBody } from './components/GuideBody';
import { getGuide } from './guides';

export const dynamic = 'force-static';

export const metadata: Metadata = {
	title: 'TechOffice user guides',
	description:
		'One workspace for a small business: the people, the routine work, the conversation about it, the schedule, and the written procedures.',
};

export default function DocsLandingPage() {
	const index = getGuide('');
	if (!index) throw new Error('content/guides/README.md is missing');

	return <GuideBody html={index.html} />;
}
