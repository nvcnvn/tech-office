/**
 * ImageViewer Component
 * Displays images with zoom and pan capabilities
 * 
 * Features:
 * - Zoom in/out controls
 * - Pan/drag to move image
 * - Fit to screen
 * - Theme system colors
 */

'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import {
	ZoomIn,
	ZoomOut,
	ZoomOutMap,
} from '@mui/icons-material';
import { useThemeColors } from '@/theme/useThemeColors';

export interface ImageViewerProps {
	fileUrl: string;
	filename: string;
	onError?: (error: Error) => void;
}

export default function ImageViewer({ fileUrl, filename, onError }: ImageViewerProps) {
	const colors = useThemeColors();
	const [scale, setScale] = useState<number>(1.0);
	const [position, setPosition] = useState({ x: 0, y: 0 });
	const [isDragging, setIsDragging] = useState(false);
	const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
	const [imageLoaded, setImageLoaded] = useState(false);
	const [imageError, setImageError] = useState(false);
	const imageRef = useRef<HTMLImageElement>(null);

	useEffect(() => {
		// Reset state when file changes
		setScale(1.0);
		setPosition({ x: 0, y: 0 });
		setImageLoaded(false);
		setImageError(false);
	}, [fileUrl]);

	const handleZoomIn = () => {
		setScale((prev) => Math.min(prev + 0.2, 5.0));
	};

	const handleZoomOut = () => {
		setScale((prev) => Math.max(prev - 0.2, 0.5));
	};

	const handleFitToScreen = () => {
		setScale(1.0);
		setPosition({ x: 0, y: 0 });
	};

	const handleMouseDown = (e: React.MouseEvent) => {
		if (scale > 1.0) {
			setIsDragging(true);
			setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
		}
	};

	const handleMouseMove = (e: React.MouseEvent) => {
		if (isDragging) {
			setPosition({
				x: e.clientX - dragStart.x,
				y: e.clientY - dragStart.y,
			});
		}
	};

	const handleMouseUp = () => {
		setIsDragging(false);
	};

	const handleImageLoad = () => {
		setImageLoaded(true);
	};

	const handleImageError = () => {
		setImageError(true);
		setImageLoaded(true);
		onError?.(new Error('Failed to load image'));
	};

	return (
		<Box
			sx={{
				display: 'flex',
				flexDirection: 'column',
				height: '100%',
				width: '100%',
				overflow: 'hidden',
			}}
			data-testid="image-viewer"
		>
			{/* Controls */}
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					padding: 2,
					...colors.bg.elevated.style,
					borderBottom: 1,
					borderColor: 'divider',
				}}
				className={colors.border.default.className}
			>
				{/* Filename */}
				<Typography
					variant="body2"
					sx={{
						...colors.text.primary.style,
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
						maxWidth: '50%',
					}}
				>
					{filename}
				</Typography>

				{/* Zoom Controls */}
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
					<IconButton
						onClick={handleZoomOut}
						disabled={scale <= 0.5}
						size="small"
						data-testid="image-zoom-out"
						sx={{ ...colors.text.primary.style }}
					>
						<ZoomOut />
					</IconButton>
					<Typography variant="body2" sx={{ ...colors.text.primary.style, minWidth: 50, textAlign: 'center' }}>
						{Math.round(scale * 100)}%
					</Typography>
					<IconButton
						onClick={handleZoomIn}
						disabled={scale >= 5.0}
						size="small"
						data-testid="image-zoom-in"
						sx={{ ...colors.text.primary.style }}
					>
						<ZoomIn />
					</IconButton>
					<IconButton
						onClick={handleFitToScreen}
						size="small"
						data-testid="image-fit-screen"
						sx={{ ...colors.text.primary.style }}
					>
						<ZoomOutMap />
					</IconButton>
				</Box>
			</Box>

			{/* Image Display */}
			<Box
				sx={{
					flex: 1,
					overflow: 'hidden',
					display: 'flex',
					justifyContent: 'center',
					alignItems: 'center',
					...colors.bg.default.style,
					cursor: scale > 1.0 ? (isDragging ? 'grabbing' : 'grab') : 'default',
				}}
				onMouseDown={handleMouseDown}
				onMouseMove={handleMouseMove}
				onMouseUp={handleMouseUp}
				onMouseLeave={handleMouseUp}
			>
				{!imageLoaded && !imageError && (
					<Typography variant="body2" sx={{ ...colors.text.secondary.style }}>
						Loading image...
					</Typography>
				)}
				{imageError ? (
					<Box
						sx={{
							display: 'flex',
							flexDirection: 'column',
							alignItems: 'center',
							gap: 2,
							padding: 4,
						}}
					>
						<Typography variant="h6" color="error">
							Failed to load image
						</Typography>
						<Typography variant="body2" sx={{ ...colors.text.secondary.style }}>
							The image file could not be loaded. Please try again.
						</Typography>
					</Box>
				) : (
					// eslint-disable-next-line @next/next/no-img-element
					<img
						ref={imageRef}
						src={fileUrl}
						alt={filename}
						onLoad={handleImageLoad}
						onError={handleImageError}
						style={{
							maxWidth: scale === 1.0 ? '100%' : 'none',
							maxHeight: scale === 1.0 ? '100%' : 'none',
							transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
							transition: isDragging ? 'none' : 'transform 0.2s ease-out',
							userSelect: 'none',
							pointerEvents: 'none',
						}}
						draggable={false}
					/>
				)}
			</Box>
		</Box>
	);
}
