/**
 * GpsLocationPicker
 * Leaflet/OSM map for admins to pin the expected GPS check-in location.
 * Dynamically imported (ssr: false) by the evidence requirement editor.
 *
 * Feature: 022-recurring-ritual-tasks-system-for
 */

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, TextField, Typography, Slider } from '@mui/material';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import { useThemeColors } from '@/theme/useThemeColors';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// ---------------------------------------------------------------------------
// Fix Leaflet's bundled default icon path (broken by webpack asset hashing)
// ---------------------------------------------------------------------------
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
	iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
	iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
	shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

export interface GpsLocation {
	latitude: number;
	longitude: number;
}

interface GpsLocationPickerProps {
	location?: GpsLocation;
	radiusMeters: number;
	onLocationChange: (loc: GpsLocation) => void;
	onRadiusChange: (r: number) => void;
}

const DEFAULT_CENTER: [number, number] = [21.0, 105.8]; // Hanoi
const DEFAULT_ZOOM = 4;
const PINNED_ZOOM = 15;

export default function GpsLocationPicker({
	location,
	radiusMeters,
	onLocationChange,
	onRadiusChange,
}: GpsLocationPickerProps) {
	const colors = useThemeColors();
	const mapRef = useRef<HTMLDivElement | null>(null);
	const mapInstanceRef = useRef<L.Map | null>(null);
	const markerRef = useRef<L.Marker | null>(null);
	const circleRef = useRef<L.Circle | null>(null);
	const [locating, setLocating] = useState(false);

	// ----- initialise map -----
	useEffect(() => {
		if (!mapRef.current || mapInstanceRef.current) return;

		const map = L.map(mapRef.current, {
			center: location ? [location.latitude, location.longitude] : DEFAULT_CENTER,
			zoom: location ? PINNED_ZOOM : DEFAULT_ZOOM,
			zoomControl: true,
		});

		L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
			maxZoom: 19,
		}).addTo(map);

		mapInstanceRef.current = map;

		// click to place/move pin
		map.on('click', (e: L.LeafletMouseEvent) => {
			const { lat, lng } = e.latlng;
			onLocationChange({ latitude: lat, longitude: lng });
		});

		return () => {
			map.remove();
			mapInstanceRef.current = null;
		};
		// intentionally run once
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// ----- sync marker + circle when location/radius changes -----
	useEffect(() => {
		const map = mapInstanceRef.current;
		if (!map) return;

		// remove old
		markerRef.current?.remove();
		circleRef.current?.remove();

		if (location) {
			const latlng: L.LatLngExpression = [location.latitude, location.longitude];
			markerRef.current = L.marker(latlng, { draggable: true })
				.addTo(map)
				.on('dragend', (e: L.LeafletEvent) => {
					const m = e.target as L.Marker;
					const pos = m.getLatLng();
					onLocationChange({ latitude: pos.lat, longitude: pos.lng });
				});
			circleRef.current = L.circle(latlng, {
				radius: radiusMeters,
				color: '#1976d2',
				fillColor: '#1976d2',
				fillOpacity: 0.12,
				weight: 1.5,
			}).addTo(map);
		}
	}, [location, radiusMeters, onLocationChange]);

	const handleGeolocate = () => {
		if (!navigator.geolocation) return;
		setLocating(true);
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				const loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
				onLocationChange(loc);
				mapInstanceRef.current?.flyTo([loc.latitude, loc.longitude], PINNED_ZOOM, { duration: 1 });
				setLocating(false);
			},
			() => { setLocating(false); },
			{ timeout: 8000 }
		);
	};

	const handleLatChange = (v: string) => {
		const lat = parseFloat(v);
		if (!isNaN(lat) && lat >= -90 && lat <= 90)
			onLocationChange({ latitude: lat, longitude: location?.longitude ?? 0 });
	};
	const handleLngChange = (v: string) => {
		const lng = parseFloat(v);
		if (!isNaN(lng) && lng >= -180 && lng <= 180)
			onLocationChange({ latitude: location?.latitude ?? 0, longitude: lng });
	};

	const primaryColor = colors.primary.text.style.color as string;

	return (
		<Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
			{/* Map */}
			<Box
				ref={mapRef}
				sx={{
					height: 260,
					borderRadius: 1,
					border: '1px solid',
					borderColor: 'divider',
					overflow: 'hidden',
					position: 'relative',
					cursor: 'crosshair',
				}}
			/>

			<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
				Click on the map to place the check-in pin, or use the fields below. Workers must be within the radius to auto-approve.
			</Typography>

			{/* Coordinate inputs + geolocate */}
			<Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-end' }}>
				<TextField
					label="Latitude" size="small" sx={{ width: 130 }}
					value={location?.latitude?.toFixed(6) ?? ''}
					onChange={(e) => handleLatChange(e.target.value)}
					placeholder="-90 … 90"
					inputProps={{ inputMode: 'decimal' }}
				/>
				<TextField
					label="Longitude" size="small" sx={{ width: 130 }}
					value={location?.longitude?.toFixed(6) ?? ''}
					onChange={(e) => handleLngChange(e.target.value)}
					placeholder="-180 … 180"
					inputProps={{ inputMode: 'decimal' }}
				/>
				<Button
					size="small" variant="outlined"
					startIcon={<MyLocationIcon fontSize="small" />}
					onClick={handleGeolocate}
					disabled={locating}
				>
					{locating ? 'Locating…' : 'My location'}
				</Button>
			</Box>

			{/* Radius */}
			<Box>
				<Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
					<Typography variant="caption" sx={colors.text.secondary.style}>
						Geofence radius
					</Typography>
					<Typography variant="caption" sx={{ ...colors.text.primary.style, fontWeight: 500 }}>
						{radiusMeters >= 1000
							? `${(radiusMeters / 1000).toFixed(1)} km`
							: `${radiusMeters} m`}
					</Typography>
				</Box>
				<Slider
					min={50} max={5000} step={50}
					value={radiusMeters}
					onChange={(_, v) => onRadiusChange(v as number)}
					sx={{ color: primaryColor }}
					marks={[
						{ value: 50, label: '50 m' },
						{ value: 200, label: '200 m' },
						{ value: 1000, label: '1 km' },
						{ value: 5000, label: '5 km' },
					]}
					valueLabelDisplay="auto"
					valueLabelFormat={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${v} m`}
				/>
			</Box>
		</Box>
	);
}
