'use client';

import Link from 'next/link';
import { Box, Button, Divider, Paper, Stack, Typography } from '@mui/material';
import GavelIcon from '@mui/icons-material/Gavel';
import PrivacyTipIcon from '@mui/icons-material/PrivacyTip';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import BlockIcon from '@mui/icons-material/Block';
import { ABUSE_CONTACT_EMAIL, PRIVACY_POLICY_PATH, TERMS_PATH } from 'apis';

/**
 * Legal and safety links for the signed-in settings page (Feature 036, FR-013).
 *
 * The same three destinations exist on mobile settings. Reporting from inside the
 * product is the primary route, because it reaches the workspace's own owners; the
 * email address is for the cases in-app reporting cannot cover.
 */
export function LegalAndSafetySection() {
	return (
		<Paper sx={{ p: 3, mt: 3, bgcolor: 'background.paper', borderColor: 'divider', border: 1 }}>
			<Typography variant="h6" component="h2" color="text.primary" gutterBottom>
				Legal &amp; safety
			</Typography>
			<Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
				What we collect, the rules for using TechOffice, and how to raise a problem.
			</Typography>

			<Divider sx={{ mb: 2, borderColor: 'divider' }} />

			<Stack spacing={1.5}>
				<Button
					component={Link}
					href={PRIVACY_POLICY_PATH}
					target="_blank"
					rel="noopener noreferrer"
					startIcon={<PrivacyTipIcon />}
					sx={{ justifyContent: 'flex-start' }}
					data-testid="settings-privacy-policy-link"
				>
					Privacy policy
				</Button>
				<Button
					component={Link}
					href={TERMS_PATH}
					target="_blank"
					rel="noopener noreferrer"
					startIcon={<GavelIcon />}
					sx={{ justifyContent: 'flex-start' }}
					data-testid="settings-terms-link"
				>
					Terms of service
				</Button>
				<Button
					component={Link}
					href="/workspace/settings/blocked"
					startIcon={<BlockIcon />}
					sx={{ justifyContent: 'flex-start' }}
					data-testid="settings-blocked-people-link"
				>
					Blocked people
				</Button>
				<Box>
					<Button
						href={`mailto:${ABUSE_CONTACT_EMAIL}`}
						startIcon={<ReportProblemIcon />}
						sx={{ justifyContent: 'flex-start' }}
						data-testid="settings-abuse-contact-link"
					>
						Report abuse
					</Button>
					<Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 4 }}>
						Reporting from a message reaches this workspace&apos;s owners faster.{' '}
						{ABUSE_CONTACT_EMAIL} is for when that is not possible.
					</Typography>
				</Box>
			</Stack>
		</Paper>
	);
}
