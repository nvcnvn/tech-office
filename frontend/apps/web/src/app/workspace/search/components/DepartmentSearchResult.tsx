'use client';

import React from 'react';
import { Paper, Box, Typography, Chip } from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import type { DepartmentSearchResult as DepartmentResult } from 'apis';

interface DepartmentSearchResultProps {
	department: DepartmentResult;
}

/**
 * Department search result card component
 * 
 * Displays department name, description, member count, and relevance score
 */
export default function DepartmentSearchResult({ department }: DepartmentSearchResultProps) {
	const handleClick = () => {
		// TODO: Navigate to department page
		console.log('Navigate to department:', department.id);
	};

	return (
		<Paper
			sx={{
				p: 2,
				cursor: 'pointer',
				transition: 'border-color 0.2s',
				'&:hover': {
					borderColor: 'text.disabled',
				},
			}}
			onClick={handleClick}
		>
			<Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
				{/* Icon */}
				<Box
					sx={{
						p: 1,
						borderRadius: 1,
						bgcolor: 'primary.light',
						color: 'primary.contrastText',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
					}}
				>
					<BusinessIcon />
				</Box>

				{/* Content */}
				<Box sx={{ flex: 1, minWidth: 0 }}>
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
						<Typography variant="body1" fontWeight="medium" noWrap>
							{department.name}
						</Typography>
						<Chip
							label={`${department.memberCount} member${department.memberCount === 1 ? '' : 's'}`}
							size="small"
							variant="outlined"
						/>
					</Box>
					{department.description && (
						<Typography
							variant="body2"
							color="text.secondary"
							sx={{
								overflow: 'hidden',
								textOverflow: 'ellipsis',
								display: '-webkit-box',
								WebkitLineClamp: 2,
								WebkitBoxOrient: 'vertical',
							}}
						>
							{department.description}
						</Typography>
					)}
				</Box>

				{/* Relevance Score */}
				<Chip
					label={`${Math.round(department.relevanceScore * 100)}%`}
					size="small"
					color="primary"
					variant="outlined"
				/>
			</Box>
		</Paper>
	);
}
