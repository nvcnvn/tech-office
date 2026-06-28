/**
 * Loading state for OAuth callback page
 * Displayed while processing authentication callback
 */

import { Box, CircularProgress, Typography } from '@mui/material';

export default function CallbackLoading() {
	return (
		<Box
			sx={{
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				minHeight: '100vh',
				gap: 2,
			}}
		>
			<CircularProgress size={48} />
			<Typography variant="h6" color="text.secondary">
				Completing sign-in...
			</Typography>
			<Typography variant="body2" color="text.secondary">
				Please wait while we authenticate your account
			</Typography>
		</Box>
	);
}
