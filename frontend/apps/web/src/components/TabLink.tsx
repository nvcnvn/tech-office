/**
 * TabLink Component
 * A reusable tab button that acts as a clickable link
 * Allows users to:
 * - Click to navigate normally
 * - Right-click to open in new tab
 * - Cmd/Ctrl+Click to open in new tab
 * - Shows active state based on current path
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useThemeColors } from '@/theme/useThemeColors';

export interface TabLinkProps {
	id: string;
	label: string;
	icon?: string;
	emoji?: string;
	href: string;
	isActive?: boolean;
	shortcut?: string;
	disabled?: boolean;
	className?: string;
	activeClassName?: string;
	inactiveClassName?: string;
	onClick?: (id: string) => void;
}

export default function TabLink({
	id,
	label,
	icon,
	emoji,
	href,
	isActive: isActiveProp,
	shortcut,
	disabled = false,
	className = '',
	activeClassName,
	inactiveClassName,
	onClick,
}: TabLinkProps) {
	const pathname = usePathname();
	const colors = useThemeColors();

	// Use theme-aware colors as defaults if not provided
	const defaultActiveClassName = `${colors.primary.light.className} ${colors.primary.text.className}`;
	const defaultInactiveClassName = `${colors.text.secondary.className} ${colors.bg.hover}`;

	const finalActiveClassName = activeClassName || defaultActiveClassName;
	const finalInactiveClassName = inactiveClassName || defaultInactiveClassName;

	// Determine if this tab is active
	// For exact match paths (like '/'), require exact match
	// For nested paths (like '/workspace/calendar'), use startsWith
	const isActive = isActiveProp !== undefined
		? isActiveProp
		: pathname === href || (href !== '/' && pathname.startsWith(href));

	const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
		// If onClick is provided and it's a normal click (not cmd/ctrl+click or middle-click)
		if (onClick && !e.metaKey && !e.ctrlKey && e.button === 0) {
			e.preventDefault();
			onClick(id);
		}
	};

	const baseClassName = `px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors ${isActive ? finalActiveClassName : disabled ? `${colors.text.disabled.className} cursor-not-allowed` : finalInactiveClassName
		} ${className}`;

	if (disabled) {
		return (
			<button
				disabled
				className={baseClassName}
			>
				{(icon || emoji) && <span className="text-base">{icon || emoji}</span>}
				<span>{label}</span>
				{shortcut && <span className="text-xs opacity-60 ml-1">{shortcut}</span>}
			</button>
		);
	}

	return (
		<Link
			href={href}
			onClick={handleClick}
			className={baseClassName}
			aria-current={isActive ? 'page' : undefined}
		>
			{(icon || emoji) && <span className="text-base">{icon || emoji}</span>}
			<span>{label}</span>
			{shortcut && <span className="text-xs opacity-60 ml-1">{shortcut}</span>}
		</Link>
	);
}
