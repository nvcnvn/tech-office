/**
 * Workspace Root Page
 * Redirects to Calendar as the default workday landing page
 */

import { redirect } from 'next/navigation';

export default function WorkspaceRootPage() {
	redirect('/workspace/calendar');
}
