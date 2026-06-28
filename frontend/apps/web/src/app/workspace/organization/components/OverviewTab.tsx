/**
 * Organization Overview Tab
 * Shows organization info, stats, recent members, departments, and activity
 * Optimized for wide screens with compact vertical spacing
 */

'use client';

import { Typography } from '@mui/material';
import { useThemeColors } from '@/theme/useThemeColors';

interface OverviewTabProps {
	organizationName?: string;
	organizationDomain?: string;
}

export default function OverviewTab({ organizationName, organizationDomain }: OverviewTabProps) {
	const colors = useThemeColors();

	return (
		<div className="space-y-4">
			{/* Organization Info - Compact header */}
			<div className={`${colors.card.info.bg} ${colors.card.info.border} border rounded-lg p-4`}>
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						<div className={`w-12 h-12 ${colors.gradients.indigo} rounded-xl flex items-center justify-center shrink-0`}>
							<span className="text-white font-bold text-lg">
								{organizationName?.[0]?.toUpperCase() || 'O'}
							</span>
						</div>
						<div>
							<Typography variant="h6" fontWeight="bold">{organizationName}</Typography>
							<Typography variant="caption" color="text.secondary" className="font-mono">{organizationDomain}</Typography>
							<div className="flex gap-2 mt-1">
								<span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">
									Active
								</span>
								<span className={`px-2 py-0.5 ${colors.primary.light.className} ${colors.primary.text.className} rounded text-xs font-medium`}>
									Enterprise Plan
								</span>
							</div>
						</div>
					</div>
					<button className={`${colors.text.secondary.className} hover:opacity-80`}>
						<span className="text-xl">⚙️</span>
					</button>
				</div>
			</div>

			{/* Organization Stats - 4 columns for horizontal space utilization */}
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
				<div className={`${colors.bg.paper.className} ${colors.border.default.className} border rounded-lg p-3`}>
					<div className="flex items-center justify-between mb-1">
						<span className="text-xl">👥</span>
						<Typography variant="caption" color="text.secondary">+3 this week</Typography>
					</div>
					<Typography variant="h4" fontWeight="bold">24</Typography>
					<Typography variant="caption" color="text.secondary">Team Members</Typography>
				</div>
				<div className={`${colors.bg.paper.className} ${colors.border.default.className} border rounded-lg p-3`}>
					<div className="flex items-center justify-between mb-1">
						<span className="text-xl">🏢</span>
						<Typography variant="caption" color="text.secondary">Active</Typography>
					</div>
					<Typography variant="h4" fontWeight="bold">5</Typography>
					<Typography variant="caption" color="text.secondary">Departments</Typography>
				</div>
				<div className={`${colors.bg.paper.className} ${colors.border.default.className} border rounded-lg p-3`}>
					<div className="flex items-center justify-between mb-1">
						<span className="text-xl">🔑</span>
						<Typography variant="caption" color="text.secondary">Defined</Typography>
					</div>
					<Typography variant="h4" fontWeight="bold">12</Typography>
					<Typography variant="caption" color="text.secondary">Roles</Typography>
				</div>
				<div className={`${colors.bg.paper.className} ${colors.border.default.className} border rounded-lg p-3`}>
					<div className="flex items-center justify-between mb-1">
						<span className="text-xl">📋</span>
						<Typography variant="caption" color="text.secondary">In progress</Typography>
					</div>
					<Typography variant="h4" fontWeight="bold">18</Typography>
					<Typography variant="caption" color="text.secondary">Active Projects</Typography>
				</div>
			</div>

			{/* Recent Members - Dense list with compact row height */}
			<div className={`${colors.bg.paper.className} ${colors.border.default.className} border rounded-lg p-4`}>
				<div className="flex items-center justify-between mb-3">
					<Typography variant="subtitle2" fontWeight="semibold">Recent Members</Typography>
					<button className={`text-xs ${colors.primary.text.className} hover:opacity-80`}>View All</button>
				</div>
				<div className="space-y-1">
					{[
						{ name: 'Alice Johnson', role: 'Engineering Manager', avatar: 'A', color: 'bg-slate-700', joined: '2 days ago' },
						{ name: 'Bob Smith', role: 'Senior Developer', avatar: 'B', color: 'bg-slate-600', joined: '5 days ago' },
						{ name: 'Carol Williams', role: 'Product Designer', avatar: 'C', color: 'bg-slate-500', joined: '1 week ago' },
						{ name: 'David Brown', role: 'Marketing Lead', avatar: 'D', color: 'bg-slate-700', joined: '1 week ago' },
					].map((member, i) => (
						<div key={i} className={`flex items-center justify-between h-10 px-2 ${colors.bg.hover} rounded-lg transition-colors`}>
							<div className="flex items-center gap-2 flex-1 min-w-0">
								<div className={`w-8 h-8 ${member.color} rounded-full flex items-center justify-center shrink-0`}>
									<span className="text-white font-medium text-sm">{member.avatar}</span>
								</div>
								<div className="min-w-0 flex-1">
									<Typography variant="body2" fontWeight="medium" className="truncate">{member.name}</Typography>
									<Typography variant="caption" color="text.secondary" className="truncate">{member.role}</Typography>
								</div>
							</div>
							<div className="text-right shrink-0 ml-2">
								<Typography variant="caption" color="text.hint">{member.joined}</Typography>
							</div>
						</div>
					))}
				</div>
			</div>

			{/* Two-column layout for horizontal space utilization */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
				{/* Departments */}
				<div className={`${colors.bg.paper.className} ${colors.border.default.className} border rounded-lg p-4`}>
					<Typography variant="subtitle2" fontWeight="semibold" className="mb-3">Departments</Typography>
					<div className="space-y-2">
						{[
							{ name: 'Engineering', count: 12, color: 'blue' },
							{ name: 'Product', count: 5, color: 'purple' },
							{ name: 'Sales', count: 4, color: 'green' },
							{ name: 'Marketing', count: 3, color: 'pink' },
						].map((dept, i) => (
							<div key={i} className={`flex items-center justify-between h-10 px-2 ${colors.bg.hover} rounded-lg`}>
								<div className="flex items-center gap-2">
									<div className={`w-2 h-2 bg-${dept.color}-500 rounded-full`}></div>
									<Typography variant="body2">{dept.name}</Typography>
								</div>
								<Typography variant="caption" color="text.secondary">{dept.count} members</Typography>
							</div>
						))}
					</div>
				</div>

				{/* Activity Feed - Compact */}
				<div className={`${colors.bg.paper.className} ${colors.border.default.className} border rounded-lg p-4`}>
					<Typography variant="subtitle2" fontWeight="semibold" className="mb-3">Recent Activity</Typography>
					<div className="space-y-2">
						{[
							{ action: 'Alice Johnson joined Engineering', time: '2h ago', icon: '👋' },
							{ action: 'New dept "Customer Success"', time: '5h ago', icon: '🎯' },
							{ action: 'Bob promoted to Senior', time: '1d ago', icon: '⭐' },
							{ action: 'Permissions updated', time: '2d ago', icon: '🔑' },
						].map((activity, i) => (
							<div key={i} className={`flex items-start gap-2 h-10 px-2 ${colors.bg.hover} rounded-lg`}>
								<span className="text-lg">{activity.icon}</span>
								<div className="flex-1 min-w-0">
									<Typography variant="body2" className="truncate">{activity.action}</Typography>
									<Typography variant="caption" color="text.hint">{activity.time}</Typography>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
