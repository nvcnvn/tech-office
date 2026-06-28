/**
 * DepartmentOrgChart
 * React Flow canvas with dagre hierarchical layout for department org chart.
 * Uses @xyflow/react for pan/zoom canvas and @dagrejs/dagre for TB layout.
 * All colors use useThemeColors() — no hardcoded hex/rgb values.
 */

'use client';

import { useMemo, useCallback, useEffect, useState } from 'react';
import {
	ReactFlow,
	Background,
	Controls,
	MiniMap,
	ReactFlowProvider,
	useNodesState,
	useEdgesState,
	useReactFlow,
	type Edge,
	BackgroundVariant,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { useTheme } from '@mui/material/styles';
import '@xyflow/react/dist/style.css';
import { useThemeColors } from '@/theme/useThemeColors';
import type { department } from 'apis';
import DepartmentOrgNode, {
	type DepartmentFlowNode,
	type DepartmentNodeData,
	ORG_NODE_WIDTH,
	ORG_NODE_HEIGHT,
	getExpandedNodeHeight,
} from './DepartmentOrgNode';

// Register custom node types outside the component to avoid re-creation on every render
const nodeTypes = { departmentNode: DepartmentOrgNode };

export interface DepartmentOrgChartProps {
	departments: department.Department[];
	onCreateChild: (parentId: string) => void;
	onEdit: (departmentId: string) => void;
	onMove: (departmentId: string) => void;
	onAddEmployee: (departmentId: string) => void;
	onAssignManager: (departmentId: string) => void;
	onMoveMember: (employeeId: string, currentRole: string, fromDepartmentId: string) => void;
	onDropDepartment: (departmentId: string, newParentId: string) => void;
	onDropMember: (employeeId: string, role: string, fromDepartmentId: string, toDepartmentId: string) => void;
}

type Callbacks = Pick<
	DepartmentOrgChartProps,
	'onEdit' | 'onMove' | 'onAddEmployee' | 'onAssignManager' | 'onCreateChild' | 'onMoveMember' | 'onDropDepartment' | 'onDropMember'
> & {
	expandedNodes: Set<string>;
	onToggleExpand: (departmentId: string) => void;
	dropTargetId: string | null;
	onDragOverNode: (departmentId: string | null) => void;
};

/**
 * Compute dagre layout and return typed React Flow nodes and edges.
 * Uses dynamic node heights when nodes are expanded to show members.
 */
function computeLayout(
	departments: department.Department[],
	callbacks: Callbacks,
): { nodes: DepartmentFlowNode[]; edges: Edge[] } {
	const g = new dagre.graphlib.Graph();
	g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 120, marginx: 40, marginy: 40 });
	g.setDefaultEdgeLabel(() => ({}));

	for (const dept of departments) {
		const isExpanded = callbacks.expandedNodes.has(dept.id);
		const nodeHeight = isExpanded
			? getExpandedNodeHeight(dept.memberCount || 0)
			: ORG_NODE_HEIGHT;
		g.setNode(dept.id, { width: ORG_NODE_WIDTH, height: nodeHeight });
	}

	const edgeList: Edge[] = [];
	for (const dept of departments) {
		if (dept.parentDepartmentId) {
			g.setEdge(dept.parentDepartmentId, dept.id);
			edgeList.push({
				id: `edge-${dept.parentDepartmentId}-${dept.id}`,
				source: dept.parentDepartmentId,
				target: dept.id,
				type: 'smoothstep',
			});
		}
	}

	dagre.layout(g);

	const nodes: DepartmentFlowNode[] = departments.map((dept) => {
		const nodeWithPos = g.node(dept.id);
		const isExpanded = callbacks.expandedNodes.has(dept.id);
		const nodeHeight = isExpanded
			? getExpandedNodeHeight(dept.memberCount || 0)
			: ORG_NODE_HEIGHT;
		const data: DepartmentNodeData = {
			department: dept,
			onEdit: callbacks.onEdit,
			onMove: callbacks.onMove,
			onAddEmployee: callbacks.onAddEmployee,
			onAssignManager: callbacks.onAssignManager,
			onCreateChild: callbacks.onCreateChild,
			onMoveMember: callbacks.onMoveMember,
			onDropDepartment: callbacks.onDropDepartment,
			onDropMember: callbacks.onDropMember,
			isExpanded,
			onToggleExpand: callbacks.onToggleExpand,
			isDropTarget: callbacks.dropTargetId === dept.id,
			onDragOverNode: callbacks.onDragOverNode,
		};
		return {
			id: dept.id,
			type: 'departmentNode' as const,
			// dagre returns center coords; React Flow expects top-left origin
			position: {
				x: nodeWithPos.x - ORG_NODE_WIDTH / 2,
				y: nodeWithPos.y - nodeHeight / 2,
			},
			data,
		};
	});

	return { nodes, edges: edgeList };
}

/** Inner component — must be a child of ReactFlowProvider to use useReactFlow. */
function OrgChartInner({
	departments,
	onCreateChild,
	onEdit,
	onMove,
	onAddEmployee,
	onAssignManager,
	onMoveMember,
	onDropDepartment,
	onDropMember,
}: DepartmentOrgChartProps) {
	const colors = useThemeColors();
	const theme = useTheme();
	const isDark = theme.palette.mode === 'dark';
	const { fitView } = useReactFlow();

	// Track which department nodes are expanded to show members
	const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
	// Track which node is being hovered during a drag for visual feedback
	const [dropTargetId, setDropTargetId] = useState<string | null>(null);

	const handleToggleExpand = useCallback((departmentId: string) => {
		setExpandedNodes((prev) => {
			const next = new Set(prev);
			if (next.has(departmentId)) {
				next.delete(departmentId);
			} else {
				next.add(departmentId);
			}
			return next;
		});
	}, []);

	const handleDragOverNode = useCallback((departmentId: string | null) => {
		setDropTargetId(departmentId);
	}, []);

	const callbacks: Callbacks = useMemo(
		() => ({ onEdit, onMove, onAddEmployee, onAssignManager, onCreateChild, onMoveMember, onDropDepartment, onDropMember, expandedNodes, onToggleExpand: handleToggleExpand, dropTargetId, onDragOverNode: handleDragOverNode }),
		[onEdit, onMove, onAddEmployee, onAssignManager, onCreateChild, onMoveMember, onDropDepartment, onDropMember, expandedNodes, handleToggleExpand, dropTargetId, handleDragOverNode],
	);

	const layout = useMemo(
		() => computeLayout(departments, callbacks),
		[departments, callbacks],
	);

	const [nodes, setNodes, onNodesChange] = useNodesState(layout.nodes);
	const [edges, setEdges, onEdgesChange] = useEdgesState(layout.edges);

	// Sync React Flow state when department data changes (e.g., after CRUD mutations)
	useEffect(() => {
		setNodes(layout.nodes);
		setEdges(layout.edges);
		// Re-fit view after layout update
		const timer = setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 50);
		return () => clearTimeout(timer);
	}, [layout, setNodes, setEdges, fitView]);

	const onInit = useCallback(() => {
		fitView({ padding: 0.15 });
	}, [fitView]);

	if (departments.length === 0) {
		return null; // Empty state is rendered by DepartmentsTab
	}

	return (
		<ReactFlow
			data-testid="org-chart-canvas"
			nodes={nodes}
			edges={edges}
			onNodesChange={onNodesChange}
			onEdgesChange={onEdgesChange}
			nodeTypes={nodeTypes}
			onInit={onInit}
			fitView
			fitViewOptions={{ padding: 0.15 }}
			minZoom={0.1}
			maxZoom={2}
			nodesDraggable={false}
			nodesConnectable={false}
			panOnDrag={true}
			zoomOnScroll={true}
			zoomOnPinch={true}
			colorMode={isDark ? 'dark' : 'light'}
		>
			<Background
				variant={BackgroundVariant.Dots}
				gap={20}
				size={1}
				color={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}
			/>
			<Controls data-testid="org-chart-controls" style={colors.bg.paper.style} showInteractive={false} />
			<MiniMap
				data-testid="org-chart-minimap"
				style={colors.bg.elevated.style}
				maskColor={isDark ? 'rgba(0,0,0,0.6)' : 'rgba(240,240,240,0.8)'}
			/>
		</ReactFlow>
	);
}

export default function DepartmentOrgChart(props: DepartmentOrgChartProps) {
	return (
		<ReactFlowProvider>
			<OrgChartInner {...props} />
		</ReactFlowProvider>
	);
}
