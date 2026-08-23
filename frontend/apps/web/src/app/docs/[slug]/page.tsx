import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { GuideBody } from '../components/GuideBody';
import { getGuide, getGuideNav } from '../guides';

export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
	return getGuideNav().map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string }>;
}): Promise<Metadata> {
	const { slug } = await params;
	const guide = getGuide(slug);
	return { title: guide ? `${guide.title} — TechOffice` : 'TechOffice user guides' };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	const guide = getGuide(slug);
	if (!guide) notFound();

	return <GuideBody html={guide.html} />;
}
