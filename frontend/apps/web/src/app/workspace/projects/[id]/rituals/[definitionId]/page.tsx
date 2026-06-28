/**
 * Ritual Definition Create/Edit Page
 * Full-page editor for ritual definitions — replaces the dialog approach.
 * Route: /workspace/tasks/[id]/rituals/new           → create
 *        /workspace/tasks/[id]/rituals/[definitionId] → edit
 *
 * Feature: 022-recurring-ritual-tasks-system-for
 *
 * UX Decision (2026-03-12): The form has 6+ top-level fields plus a full
 * CRUD section for evidence requirements. This complexity warrants a dedicated
 * page rather than a modal dialog.
 */

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import NextLink from 'next/link';
import {
	Box,
	Typography,
	Button,
	TextField,
	FormControl,
	InputLabel,
	Select,
	MenuItem,
	FormControlLabel,
	Switch,
	Chip,
	Alert,
	CircularProgress,
	Divider,
	Paper,
	Collapse,
	IconButton,
	Tooltip,
	List,
	Breadcrumbs,
	Link,
	Autocomplete,
	type TextFieldProps,
} from '@mui/material';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';

// Dynamic import — Leaflet requires window
const GpsLocationPicker = dynamic(
	() => import('./GpsLocationPicker'),
	{ ssr: false, loading: () => <Box sx={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress size={24} /></Box> }
);
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import AddIcon from '@mui/icons-material/Add';
import SaveIcon from '@mui/icons-material/Save';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useRequireAuth } from '@/lib/auth/hooks';
import { useThemeColors } from '@/theme/useThemeColors';
import { getProject, autocompleteEmployees, autocompleteDepartments, type Project, type EmployeeSuggestion, type DepartmentSuggestion } from 'apis';
import {
	getRitualDefinition,
	createRitualDefinition,
	updateRitualDefinition,
	createEvidenceRequirement,
	updateEvidenceRequirement,
	deleteEvidenceRequirement,
	listEvidenceRequirements,
	getScheduleChangeImpact,
	changeRitualDefinitionSchedule,
	type RitualDefinition,
	type RecurrenceType,
	type RecurrenceRule,
	type EvidenceType,
	type ApprovalMode,
	type EvidenceRequirementDetail,
	type AutoApproveConfig,
	type ScheduleChangeImpact,
	type AssignmentStrategy,
} from 'apis';

interface DeptPoolSlot {
	dept: DepartmentSuggestion;
	strategy: AssignmentStrategy;
}

// =============================================================================
// Constants
// =============================================================================

const TIMEZONE_OPTIONS: { label: string; value: string }[] = [
	{ label: 'UTC−12 — Baker Island', value: 'UTC-12' },
	{ label: 'UTC−11 — American Samoa (Pago Pago)', value: 'UTC-11' },
	{ label: 'UTC−10 — Hawaii (Honolulu)', value: 'UTC-10' },
	{ label: 'UTC−9 — Alaska (Anchorage)', value: 'UTC-9' },
	{ label: 'UTC−8 — Los Angeles, Vancouver', value: 'UTC-8' },
	{ label: 'UTC−7 — Denver, Phoenix', value: 'UTC-7' },
	{ label: 'UTC−6 — Chicago, Mexico City', value: 'UTC-6' },
	{ label: 'UTC−5 — New York, Toronto, Bogotá', value: 'UTC-5' },
	{ label: 'UTC−4 — Halifax, Caracas', value: 'UTC-4' },
	{ label: 'UTC−3 — São Paulo, Buenos Aires', value: 'UTC-3' },
	{ label: 'UTC−2 — South Georgia Island', value: 'UTC-2' },
	{ label: 'UTC−1 — Azores, Cape Verde', value: 'UTC-1' },
	{ label: 'UTC+0 — London, Lisbon, Reykjavík', value: 'UTC' },
	{ label: 'UTC+1 — Paris, Berlin, Rome, Amsterdam', value: 'UTC+1' },
	{ label: 'UTC+2 — Cairo, Athens, Kyiv, Helsinki', value: 'UTC+2' },
	{ label: 'UTC+3 — Moscow, Istanbul, Nairobi, Riyadh', value: 'UTC+3' },
	{ label: 'UTC+4 — Dubai, Baku, Abu Dhabi', value: 'UTC+4' },
	{ label: 'UTC+5 — Karachi, Islamabad, Tashkent', value: 'UTC+5' },
	{ label: 'UTC+6 — Dhaka, Almaty, Chittagong', value: 'UTC+6' },
	{ label: 'UTC+7 — Bangkok, Jakarta, Hanoi', value: 'UTC+7' },
	{ label: 'UTC+8 — Singapore, Beijing, Ho Chi Minh City', value: 'UTC+8' },
	{ label: 'UTC+9 — Tokyo, Seoul, Osaka', value: 'UTC+9' },
	{ label: 'UTC+10 — Sydney, Melbourne, Brisbane', value: 'UTC+10' },
	{ label: 'UTC+11 — Solomon Islands, Noumea', value: 'UTC+11' },
	{ label: 'UTC+12 — Auckland, Fiji, Suva', value: 'UTC+12' },
	{ label: 'UTC+13 — Tonga, Samoa (Apia)', value: 'UTC+13' },
	{ label: 'UTC+14 — Line Islands (Kiritimati)', value: 'UTC+14' },
];

const DAYS_OF_WEEK = [
	{ label: 'Mon', value: 1 },
	{ label: 'Tue', value: 2 },
	{ label: 'Wed', value: 3 },
	{ label: 'Thu', value: 4 },
	{ label: 'Fri', value: 5 },
	{ label: 'Sat', value: 6 },
	{ label: 'Sun', value: 7 },
];

const EVIDENCE_TYPES: { value: EvidenceType; label: string; icon: string }[] = [
	{ value: 'photo', label: 'Photo', icon: '📷' },
	{ value: 'text_note', label: 'Text note', icon: '📝' },
	{ value: 'pdf', label: 'PDF', icon: '📄' },
	{ value: 'file', label: 'File', icon: '📎' },
	{ value: 'link', label: 'Link / URL', icon: '🔗' },
	{ value: 'voice_memo', label: 'Voice memo', icon: '🎙️' },
	{ value: 'gps_checkin', label: 'GPS check-in', icon: '📍' },
];

// =============================================================================
// Markdown <-> TipTap helpers (shared logic, same as settings component)
// =============================================================================

function nodeToMd(node: unknown): string {
	if (!node || typeof node !== 'object') return '';
	const n = node as Record<string, unknown>;
	if (n.type === 'text' && typeof n.text === 'string') {
		let t = n.text;
		const marks = n.marks as Array<{ type: string }> | undefined;
		if (marks) {
			if (marks.some((m) => m.type === 'code')) t = `\`${t}\``;
			if (marks.some((m) => m.type === 'bold')) t = `**${t}**`;
			if (marks.some((m) => m.type === 'italic')) t = `*${t}*`;
		}
		return t;
	}
	if (!Array.isArray(n.content)) return '';
	const content = (n.content as unknown[]).map(nodeToMd).join('');
	switch (n.type) {
		case 'doc': return content;
		case 'paragraph': return content ? content + '\n\n' : '';
		case 'heading': {
			const lvl = (n.attrs as { level?: number })?.level ?? 1;
			return '#'.repeat(lvl) + ' ' + content.trim() + '\n';
		}
		case 'bulletList': return content;
		case 'orderedList': return content;
		case 'listItem': return '- ' + content.trim() + '\n';
		case 'blockquote': return '> ' + content.replace(/\n/g, '\n> ').trim() + '\n';
		default: return content;
	}
}

function tipTapJSONToMarkdown(json: unknown): string {
	try {
		const doc = typeof json === 'string' ? JSON.parse(json) : json;
		return nodeToMd(doc).replace(/\n{3,}/g, '\n\n').trim();
	} catch { return ''; }
}

function inlineMd(text: string): unknown[] {
	if (!text.trim()) return [];
	const nodes: unknown[] = [];
	const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		if (m.index > last) nodes.push({ type: 'text', text: text.slice(last, m.index) });
		if (m[2] !== undefined) nodes.push({ type: 'text', text: m[2], marks: [{ type: 'bold' }] });
		else if (m[3] !== undefined) nodes.push({ type: 'text', text: m[3], marks: [{ type: 'italic' }] });
		else if (m[4] !== undefined) nodes.push({ type: 'text', text: m[4], marks: [{ type: 'code' }] });
		last = m.index + m[0].length;
	}
	if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) });
	return nodes;
}

function markdownToTipTapContent(md: string): object {
	if (!md.trim()) return { type: 'doc', content: [{ type: 'paragraph', content: [] }] };
	const lines = md.split('\n');
	const content: unknown[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (!line.trim()) { i++; continue; }
		const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
		if (headingMatch) {
			content.push({ type: 'heading', attrs: { level: headingMatch[1].length }, content: inlineMd(headingMatch[2]) });
			i++; continue;
		}
		if (line.startsWith('> ')) {
			const bqLines: string[] = [];
			while (i < lines.length && lines[i].startsWith('> ')) { bqLines.push(lines[i].slice(2)); i++; }
			content.push({ type: 'blockquote', content: [{ type: 'paragraph', content: inlineMd(bqLines.join(' ')) }] });
			continue;
		}
		if (line.match(/^[-*]\s/)) {
			const items: unknown[] = [];
			while (i < lines.length && lines[i].match(/^[-*]\s/)) {
				items.push({ type: 'listItem', content: [{ type: 'paragraph', content: inlineMd(lines[i].slice(2)) }] });
				i++;
			}
			content.push({ type: 'bulletList', content: items });
			continue;
		}
		if (line.match(/^\d+\.\s/)) {
			const items: unknown[] = [];
			while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
				const text = lines[i].replace(/^\d+\.\s/, '');
				items.push({ type: 'listItem', content: [{ type: 'paragraph', content: inlineMd(text) }] });
				i++;
			}
			content.push({ type: 'orderedList', content: items });
			continue;
		}
		const paraLines: string[] = [];
		while (i < lines.length && lines[i].trim() && !lines[i].match(/^(#{1,6}\s|>\s|[-*]\s|\d+\.\s)/)) {
			paraLines.push(lines[i]); i++;
		}
		content.push({ type: 'paragraph', content: inlineMd(paraLines.join(' ')) });
	}
	return { type: 'doc', content: content.length ? content : [{ type: 'paragraph', content: [] }] };
}

// =============================================================================
// Description Editor
// =============================================================================

interface DescriptionEditorProps {
	value: string;
	onChange: (md: string) => void;
}

function DescriptionEditor({ value, onChange }: DescriptionEditorProps) {
	const colors = useThemeColors();
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	const editor = useEditor({
		extensions: [StarterKit],
		content: markdownToTipTapContent(value),
		onUpdate: ({ editor: e }) => {
			onChangeRef.current(tipTapJSONToMarkdown(e.getJSON()));
		},
	});

	const prevValueRef = useRef(value);
	useEffect(() => {
		if (!editor || value === prevValueRef.current) return;
		prevValueRef.current = value;
		queueMicrotask(() => {
			try { editor.commands.setContent(markdownToTipTapContent(value)); } catch { /* ignore */ }
		});
	}, [editor, value]);

	const primaryColor = colors.primary.text.style.color as string;
	const btn = (active: boolean, onClick: () => void, title: string, icon: React.ReactNode) => (
		<IconButton size="small" onClick={onClick} title={title} sx={{
			borderRadius: 1,
			color: active ? primaryColor : colors.text.secondary.style.color,
			background: active ? `${primaryColor}18` : 'transparent',
			'&:hover': { background: `${primaryColor}22` },
		}}>
			{icon}
		</IconButton>
	);

	return (
		<Paper variant="outlined" sx={{ borderRadius: 1, overflow: 'hidden', '&:focus-within': { borderColor: primaryColor } }}>
			<Box sx={{ display: 'flex', gap: 0.5, p: 0.5, borderBottom: '1px solid', borderColor: 'divider', background: colors.bg.active.style.backgroundColor }}>
				{btn(!!editor?.isActive('bold'), () => editor?.chain().focus().toggleBold().run(), 'Bold', <FormatBoldIcon fontSize="small" />)}
				{btn(!!editor?.isActive('italic'), () => editor?.chain().focus().toggleItalic().run(), 'Italic', <FormatItalicIcon fontSize="small" />)}
				{btn(!!editor?.isActive('bulletList'), () => editor?.chain().focus().toggleBulletList().run(), 'Bullet list', <FormatListBulletedIcon fontSize="small" />)}
				{btn(!!editor?.isActive('orderedList'), () => editor?.chain().focus().toggleOrderedList().run(), 'Numbered list', <FormatListNumberedIcon fontSize="small" />)}
				{btn(!!editor?.isActive('blockquote'), () => editor?.chain().focus().toggleBlockquote().run(), 'Blockquote', <FormatQuoteIcon fontSize="small" />)}
			</Box>
			<Box data-testid="ritual-description-editor" sx={{
				minHeight: 160, p: 1.5,
				'& .ProseMirror': { outline: 'none', minHeight: 140, ...colors.text.primary.style },
				'& .ProseMirror ul': { paddingLeft: '1.5em', marginTop: '0.25em', marginBottom: '0.25em' },
				'& .ProseMirror ol': { paddingLeft: '1.5em', marginTop: '0.25em', marginBottom: '0.25em' },
				'& .ProseMirror blockquote': { borderLeft: `3px solid ${primaryColor}`, paddingLeft: '0.75em', marginLeft: 0, ...colors.text.secondary.style },
			}}>
				<EditorContent editor={editor} />
			</Box>
		</Paper>
	);
}

// =============================================================================
// Evidence Requirement Editor (full-width version)
// =============================================================================

interface DraftEvidenceRequirement {
	_draftId: string;
	name: string;
	description: string;
	evidenceTypes: EvidenceType[];
	isRequired: boolean;
	approvalMode: ApprovalMode;
	autoApproveConfig?: AutoApproveConfig;
	deadlineOffsetHours: number;
}

type EvidenceItem = (EvidenceRequirementDetail & { _draftId?: never }) | DraftEvidenceRequirement;

function isDraft(item: EvidenceItem): item is DraftEvidenceRequirement {
	return '_draftId' in item;
}

function newDraft(): DraftEvidenceRequirement {
	return {
		_draftId: Math.random().toString(36).slice(2),
		name: '', description: '', evidenceTypes: ['photo'],
		isRequired: true, approvalMode: 'manual', autoApproveConfig: undefined, deadlineOffsetHours: 0,
	};
}

/** Evidence types that support auto-approve */
const AUTO_APPROVABLE_TYPES: EvidenceType[] = ['photo', 'gps_checkin'];

interface EvidenceRequirementEditorProps {
	ritualDefinitionId: string | null;
	initial: EvidenceRequirementDetail[];
	onChange: (drafts: DraftEvidenceRequirement[]) => void;
}

function EvidenceRequirementEditor({ ritualDefinitionId, initial, onChange }: EvidenceRequirementEditorProps) {
	const colors = useThemeColors();
	const [items, setItems] = useState<EvidenceItem[]>(() => ritualDefinitionId ? initial : []);
	const [expandedKey, setExpandedKey] = useState<string | null>(null);
	const [saving, setSaving] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<string | null>(null);
	const [itemError, setItemError] = useState<string | null>(null);

	useEffect(() => {
		if (ritualDefinitionId) setItems(initial);
		else setItems([]);
		setExpandedKey(null);
	}, [ritualDefinitionId, initial]);

	useEffect(() => {
		if (!ritualDefinitionId) onChange(items.filter(isDraft) as DraftEvidenceRequirement[]);
	}, [items, ritualDefinitionId, onChange]);

	const itemKey = (item: EvidenceItem): string => isDraft(item) ? item._draftId : item.id;

	const updateField = <K extends keyof DraftEvidenceRequirement | keyof EvidenceRequirementDetail>(
		item: EvidenceItem,
		field: K,
		value: unknown
	) => {
		const key = itemKey(item);
		setItems((prev) => prev.map((it) => itemKey(it) === key ? { ...it, [field]: value } : it));
	};

	// When approval mode changes to auto_approve, constrain evidence types to compatible ones
	const handleApprovalModeChange = (item: EvidenceItem, mode: ApprovalMode) => {
		const key = itemKey(item);
		setItems((prev) => prev.map((it) => {
			if (itemKey(it) !== key) return it;
			if (mode === 'auto_approve') {
				const compatible: EvidenceType[] = ['photo', 'gps_checkin'];
				const filtered = it.evidenceTypes.filter((t) => compatible.includes(t));
				return { ...it, approvalMode: mode, evidenceTypes: filtered.length > 0 ? filtered : ['photo'] };
			}
			// switching away from auto_approve: clear the GPS config
			return { ...it, approvalMode: mode, autoApproveConfig: undefined };
		}));
	};

	const handleAutoApproveConfigChange = (item: EvidenceItem, patch: Partial<AutoApproveConfig>) => {
		const key = itemKey(item);
		setItems((prev) => prev.map((it) => {
			if (itemKey(it) !== key) return it;
			const current: AutoApproveConfig = (it as EvidenceRequirementDetail).autoApproveConfig ?? { gpsRadiusMeters: 200, deadlineTime: '' };
			return { ...it, autoApproveConfig: { ...current, ...patch } };
		}));
	};

	const handleAdd = () => {
		const draft = newDraft();
		setItems((prev) => [...prev, draft]);
		setExpandedKey(draft._draftId);
	};

	const handleDeleteDraft = (draftId: string) => {
		setItems((prev) => prev.filter((it) => !isDraft(it) || it._draftId !== draftId));
	};

	const handleDeleteSaved = async (id: string) => {
		setDeleting(id);
		setItemError(null);
		try {
			await deleteEvidenceRequirement(id);
			setItems((prev) => prev.filter((it) => isDraft(it) || it.id !== id));
			if (expandedKey === id) setExpandedKey(null);
		} catch (err) {
			setItemError(err instanceof Error ? err.message : 'Failed to delete');
		} finally {
			setDeleting(null);
		}
	};

	const handleSaveDraft = async (draft: DraftEvidenceRequirement) => {
		if (!ritualDefinitionId || !draft.name.trim()) return;
		setSaving(draft._draftId);
		setItemError(null);
		try {
			const saved = await createEvidenceRequirement({
				ritualDefinitionId, name: draft.name.trim(), description: draft.description.trim(),
				evidenceTypes: draft.evidenceTypes, isRequired: draft.isRequired,
				approvalMode: draft.approvalMode,
				autoApproveConfig: draft.approvalMode === 'auto_approve' ? draft.autoApproveConfig : undefined,
				deadlineOffsetHours: draft.deadlineOffsetHours,
			});
			setItems((prev) => prev.map((it) => isDraft(it) && it._draftId === draft._draftId ? saved : it));
			setExpandedKey(saved.id);
		} catch (err) {
			setItemError(err instanceof Error ? err.message : 'Failed to create requirement');
		} finally {
			setSaving(null);
		}
	};

	const handleUpdateSaved = async (item: EvidenceRequirementDetail) => {
		setSaving(item.id);
		setItemError(null);
		try {
			const updated = await updateEvidenceRequirement({
				evidenceRequirementId: item.id, name: item.name, description: item.description,
				evidenceTypes: item.evidenceTypes, isRequired: item.isRequired,
				approvalMode: item.approvalMode,
				autoApproveConfig: item.approvalMode === 'auto_approve' ? item.autoApproveConfig : undefined,
				deadlineOffsetHours: item.deadlineOffsetHours,
			});
			setItems((prev) => prev.map((it) => !isDraft(it) && it.id === item.id ? updated : it));
		} catch (err) {
			setItemError(err instanceof Error ? err.message : 'Failed to update requirement');
		} finally {
			setSaving(null);
		}
	};

	return (
		<Box>
			<Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
				<Typography variant="body2" sx={{ ...colors.text.secondary.style }}>
					Define what workers must submit to complete each instance of this ritual.
				</Typography>
				<Button size="small" startIcon={<AddIcon />} onClick={handleAdd} data-testid="add-evidence-requirement-btn">
					Add requirement
				</Button>
			</Box>

			{itemError && (
				<Alert severity="error" sx={{ mb: 1 }} onClose={() => setItemError(null)}>{itemError}</Alert>
			)}

			{items.length === 0 && (
				<Paper variant="outlined" sx={{ p: 3, textAlign: 'center', ...colors.bg.active.style }}>
					<Typography variant="body2" sx={{ ...colors.text.secondary.style, fontStyle: 'italic' }} data-testid="evidence-requirements-empty">
						No evidence requirements yet. Workers can complete the ritual without uploading proof.
					</Typography>
				</Paper>
			)}

			<List disablePadding>
				{items.map((item, index) => {
					const key = itemKey(item);
					const expanded = expandedKey === key;
					const isSavingThis = saving === key;
					const isDeletingThis = deleting === key;
					const isUnsaved = isDraft(item);
					const primaryColor = colors.primary.text.style.color as string;

					return (
						<Paper key={key} variant="outlined" sx={{
							mb: 1.5, borderRadius: 1,
							borderColor: isUnsaved ? primaryColor : 'divider',
							opacity: isDeletingThis ? 0.5 : 1,
						}} data-testid={`evidence-req-item-${index}`}>
							{/* Row header */}
							<Box sx={{
								display: 'flex', alignItems: 'center', px: 2, py: 1.5,
								cursor: 'pointer', userSelect: 'none',
								'&:hover': { background: colors.bg.active.style.backgroundColor },
							}} onClick={() => setExpandedKey((prev) => prev === key ? null : key)}>
								<DragIndicatorIcon fontSize="small" sx={{ mr: 1, ...colors.text.secondary.style, opacity: 0.4 }} />
								<Box sx={{ flex: 1, minWidth: 0 }}>
									<Typography variant="body2" sx={{
										...colors.text.primary.style, fontWeight: item.name ? 500 : 400,
										fontStyle: item.name ? 'normal' : 'italic',
										overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
									}}>
										{item.name || 'Untitled requirement'}
									</Typography>
									{!expanded && item.evidenceTypes.length > 0 && (
										<Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.25 }}>
											{item.evidenceTypes.map((t) => {
												const et = EVIDENCE_TYPES.find((e) => e.value === t);
												return (
													<Chip key={t} label={et ? `${et.icon} ${et.label}` : t} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
												);
											})}
										</Box>
									)}
								</Box>
								<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
									{isUnsaved && <Chip label="Draft" size="small" color="primary" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />}
									{item.isRequired && !isUnsaved && <Chip label="Required" size="small" color="warning" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />}
									{expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
								</Box>
							</Box>

							<Collapse in={expanded}>
								<Divider />
								<Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2.5 }}>

									{/* Name */}
									<TextField
										label="Requirement name" size="small" fullWidth
										value={item.name}
										onChange={(e) => updateField(item, 'name', e.target.value)}
										inputProps={{ 'data-testid': `evidence-req-name-${index}` }}
									/>

									{/* Description */}
									<TextField
										label="Description (optional)" size="small" fullWidth multiline rows={2}
										value={item.description}
										onChange={(e) => updateField(item, 'description', e.target.value)}
										inputProps={{ 'data-testid': `evidence-req-desc-${index}` }}
									/>

									{/* Accepted submission type — single select */}
									<FormControl size="small" fullWidth>
										<InputLabel>Accepted submission type</InputLabel>
										<Select
											value={item.evidenceTypes[0] ?? 'photo'}
											onChange={(e) => {
												const selected = e.target.value as EvidenceType;
												updateField(item, 'evidenceTypes', [selected]);
												// Auto-enable GPS auto-approve when gps_checkin is selected
												if (selected === 'gps_checkin') {
													handleApprovalModeChange(item, 'auto_approve');
												} else if (!AUTO_APPROVABLE_TYPES.includes(selected)) {
													// Non-approvable type: force manual
													handleApprovalModeChange(item, 'manual');
												}
											}}
											label="Accepted submission type"
											data-testid={`evidence-type-select-${index}`}
										>
											{EVIDENCE_TYPES.map((et) => (
												<MenuItem key={et.value} value={et.value}>
													{et.icon} {et.label}
												</MenuItem>
											))}
										</Select>
									</FormControl>

									{/* Toggles row */}
									<Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
										{/* Required toggle */}
										<FormControlLabel
											control={
												<Switch
													size="small" checked={item.isRequired}
													onChange={(e) => updateField(item, 'isRequired', e.target.checked)}
													data-testid={`evidence-req-required-${index}`}
												/>
											}
											label={<Typography variant="body2">Required for completion</Typography>}
										/>

										{/* Auto-approve GPS toggle — only for photo or gps_checkin */}
										{AUTO_APPROVABLE_TYPES.includes(item.evidenceTypes[0]) && (
											<Box>
												<FormControlLabel
													control={
														<Switch
															size="small"
															checked={item.approvalMode === 'auto_approve'}
															onChange={(e) => handleApprovalModeChange(item, e.target.checked ? 'auto_approve' : 'manual')}
															data-testid={`evidence-req-approval-${index}`}
														/>
													}
													label={
														<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
															<GpsFixedIcon fontSize="small" sx={{ opacity: 0.7, fontSize: '1rem' }} />
															<Typography variant="body2">Auto-approve via GPS check-in</Typography>
														</Box>
													}
												/>
												{item.approvalMode === 'manual' && (
													<Typography variant="caption" sx={{ ...colors.text.secondary.style, pl: 4.5, display: 'block', mt: -0.5 }}>
														Admin manually reviews each submission
													</Typography>
												)}
											</Box>
										)}

										{/* Deadline offset */}
										<Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
											<FormControlLabel
												control={
													<Switch
														size="small"
														checked={item.deadlineOffsetHours === 0}
														onChange={(e) => updateField(item, 'deadlineOffsetHours', e.target.checked ? 0 : 8)}
													/>
												}
												label={<Typography variant="body2">Same deadline as ritual</Typography>}
											/>
											{item.deadlineOffsetHours !== 0 && (
												<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 4.5 }}>
													<Typography variant="caption" sx={colors.text.secondary.style}>Due within</Typography>
													<TextField
														type="number" size="small" sx={{ width: 72 }}
														value={item.deadlineOffsetHours}
														onChange={(e) => updateField(item, 'deadlineOffsetHours', Math.max(1, parseInt(e.target.value) || 1))}
														inputProps={{ min: 1, 'data-testid': `evidence-req-deadline-${index}` }}
													/>
													<Typography variant="caption" sx={colors.text.secondary.style}>
														hours
														{item.deadlineOffsetHours >= 24
															? ` (≈ ${(item.deadlineOffsetHours / 24).toFixed(1)} day${item.deadlineOffsetHours >= 48 ? 's' : ''})`
															: ''}
													</Typography>
												</Box>
											)}
										</Box>
									</Box>

									{/* GPS location picker — visible when auto_approve is ON */}
									{item.approvalMode === 'auto_approve' && (
										<Paper variant="outlined" sx={{ p: 2, borderRadius: 1, borderColor: 'primary.main', borderStyle: 'dashed' }}>
											<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
												<GpsFixedIcon fontSize="small" color="primary" />
												<Typography variant="body2" sx={{ ...colors.text.primary.style, fontWeight: 500 }}>
													Expected check-in location
												</Typography>
											</Box>
											<Typography variant="caption" sx={{ ...colors.text.secondary.style, mb: 1.5, display: 'block' }}>
												Workers must be within the geofence radius below to get auto-approved.
												Approval uses Haversine distance on the stored lat/lng — no H3 index.
											</Typography>
											<GpsLocationPicker
												location={(item as EvidenceRequirementDetail).autoApproveConfig?.gpsTarget
													? {
														latitude: (item as EvidenceRequirementDetail).autoApproveConfig!.gpsTarget!.latitude,
														longitude: (item as EvidenceRequirementDetail).autoApproveConfig!.gpsTarget!.longitude,
													}
													: undefined
												}
												radiusMeters={
													(item as EvidenceRequirementDetail).autoApproveConfig?.gpsRadiusMeters ?? 200
												}
												onLocationChange={(loc) =>
													handleAutoApproveConfigChange(item, {
														gpsTarget: { latitude: loc.latitude, longitude: loc.longitude },
													})
												}
												onRadiusChange={(r) => handleAutoApproveConfigChange(item, { gpsRadiusMeters: r })}
											/>
										</Paper>
									)}

									<Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
										<Tooltip title="Delete this requirement">
											<span>
												<IconButton size="small" color="error" disabled={isDeletingThis || isSavingThis}
													onClick={() => isDraft(item) ? handleDeleteDraft(key) : handleDeleteSaved(key)}
													data-testid={`evidence-req-delete-${index}`}>
													{isDeletingThis ? <CircularProgress size={16} /> : <DeleteOutlineIcon fontSize="small" />}
												</IconButton>
											</span>
										</Tooltip>

										{isDraft(item) && ritualDefinitionId && (
											<Button size="small" variant="contained"
												disabled={isSavingThis || !item.name.trim() || item.evidenceTypes.length === 0}
												onClick={() => handleSaveDraft(item)}
												data-testid={`evidence-req-save-${index}`}>
												{isSavingThis ? <CircularProgress size={14} /> : 'Save requirement'}
											</Button>
										)}
										{!isDraft(item) && (
											<Button size="small" variant="outlined"
												disabled={isSavingThis || !item.name.trim() || item.evidenceTypes.length === 0}
												onClick={() => handleUpdateSaved(item as EvidenceRequirementDetail)}
												data-testid={`evidence-req-update-${index}`}>
												{isSavingThis ? <CircularProgress size={14} /> : 'Save changes'}
											</Button>
										)}
										{isDraft(item) && !ritualDefinitionId && (
											<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
												Saved when the definition is created
											</Typography>
										)}
									</Box>
								</Box>
							</Collapse>
						</Paper>
					);
				})}
			</List>
		</Box>
	);
}

// =============================================================================
// Recurrence Rule Form
// =============================================================================

interface RecurrenceFormProps {
	recurrenceType: RecurrenceType;
	onRecurrenceTypeChange: (v: RecurrenceType) => void;
	interval: number;
	onIntervalChange: (v: number) => void;
	daysOfWeek: number[];
	onDaysOfWeekChange: (v: number[]) => void;
	dayOfMonth: number;
	onDayOfMonthChange: (v: number) => void;
}

function RecurrenceForm({
	recurrenceType, onRecurrenceTypeChange,
	interval, onIntervalChange,
	daysOfWeek, onDaysOfWeekChange,
	dayOfMonth, onDayOfMonthChange,
}: RecurrenceFormProps) {
	const colors = useThemeColors();

	// Human-readable summary shown below the controls
	const summary = (() => {
		switch (recurrenceType) {
			case 'daily': return interval === 1 ? 'Runs every day' : `Runs every ${interval} days`;
			case 'weekly': {
				const names = DAYS_OF_WEEK.filter((d) => daysOfWeek.includes(d.value)).map((d) => d.label);
				if (names.length === 0) return 'Select at least one day';
				const dayStr = names.join(', ');
				return interval === 1 ? `Every week on ${dayStr}` : `Every ${interval} weeks on ${dayStr}`;
			}
			case 'monthly': return `On day ${dayOfMonth} of every month`;
			case 'custom_interval': return `Every ${interval} day${interval !== 1 ? 's' : ''}`;
		}
	})();

	return (
		<Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
			{/* Row 1: Pattern selector + inline interval/day controls */}
			<Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
				<FormControl size="small" sx={{ minWidth: 200 }}>
					<InputLabel>Repeat</InputLabel>
					<Select
						value={recurrenceType}
						onChange={(e) => onRecurrenceTypeChange(e.target.value as RecurrenceType)}
						label="Repeat"
						data-testid="ritual-recurrence-type-select"
					>
						<MenuItem value="daily">Daily</MenuItem>
						<MenuItem value="weekly">Weekly</MenuItem>
						<MenuItem value="monthly">Monthly</MenuItem>
						<MenuItem value="custom_interval">Custom interval</MenuItem>
					</Select>
				</FormControl>

				{/* Inline: every N days (daily / custom) */}
				{(recurrenceType === 'daily' || recurrenceType === 'custom_interval') && (
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
						<Typography variant="body2" sx={colors.text.secondary.style}>every</Typography>
						<TextField
							type="number" size="small" sx={{ width: 80 }}
							value={interval}
							onChange={(e) => onIntervalChange(Math.max(1, parseInt(e.target.value) || 1))}
							inputProps={{ min: 1, 'data-testid': 'ritual-interval-input' }}
						/>
						<Typography variant="body2" sx={colors.text.secondary.style}>
							{recurrenceType === 'daily' ? `day${interval !== 1 ? 's' : ''}` : `day${interval !== 1 ? 's' : ''}`}
						</Typography>
					</Box>
				)}

				{/* Inline: on day N (monthly) */}
				{recurrenceType === 'monthly' && (
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
						<Typography variant="body2" sx={colors.text.secondary.style}>on day</Typography>
						<TextField
							type="number" size="small" sx={{ width: 80 }}
							value={dayOfMonth || 1}
							onChange={(e) => onDayOfMonthChange(Math.min(28, Math.max(1, parseInt(e.target.value) || 1)))}
							inputProps={{ min: 1, max: 28, 'data-testid': 'ritual-day-of-month-input' }}
						/>
						<Typography variant="body2" sx={colors.text.secondary.style}>of each month</Typography>
					</Box>
				)}

				{/* Inline: every N weeks (weekly) */}
				{recurrenceType === 'weekly' && (
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
						<Typography variant="body2" sx={colors.text.secondary.style}>every</Typography>
						<TextField
							type="number" size="small" sx={{ width: 80 }}
							value={interval}
							onChange={(e) => onIntervalChange(Math.max(1, parseInt(e.target.value) || 1))}
							inputProps={{ min: 1, 'data-testid': 'ritual-interval-weeks-input' }}
						/>
						<Typography variant="body2" sx={colors.text.secondary.style}>week{interval !== 1 ? 's' : ''} on:</Typography>
					</Box>
				)}
			</Box>

			{/* Row 2: Day-of-week chips (weekly only) */}
			{recurrenceType === 'weekly' && (
				<Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', pl: 0.25 }}>
					{DAYS_OF_WEEK.map((d) => {
						const checked = daysOfWeek.includes(d.value);
						return (
							<Chip
								key={d.value}
								label={d.label}
								size="small"
								variant={checked ? 'filled' : 'outlined'}
								color={checked ? 'primary' : 'default'}
								onClick={() => {
									const next = checked ? daysOfWeek.filter((v) => v !== d.value) : [...daysOfWeek, d.value];
									onDaysOfWeekChange(next);
								}}
								sx={{ cursor: 'pointer', minWidth: 48, justifyContent: 'center' }}
								data-testid={`day-of-week-chip-${d.value}`}
							/>
						);
					})}
				</Box>
			)}

			{/* Summary line */}
			<Typography variant="caption" sx={{
				...colors.text.secondary.style,
				color: recurrenceType === 'weekly' && daysOfWeek.length === 0 ? 'warning.main' : undefined,
				fontStyle: 'italic',
			}}>
				→ {summary}
			</Typography>
		</Box>
	);
}

// =============================================================================
// Assignee Picker
// =============================================================================

interface AssigneePickerProps {
	value: EmployeeSuggestion[];
	onChange: (v: EmployeeSuggestion[]) => void;
}

function getEmployeeLabel(emp: EmployeeSuggestion): string {
	const full = `${emp.givenName} ${emp.familyName}`.trim();
	// Placeholder objects created from bare UUIDs have familyName='…'
	return full && emp.familyName !== '…' ? full : emp.id.slice(0, 8);
}

function AssigneePicker({ value, onChange }: AssigneePickerProps) {
	const colors = useThemeColors();
	const [inputValue, setInputValue] = useState('');
	const [options, setOptions] = useState<EmployeeSuggestion[]>([]);
	const [searching, setSearching] = useState(false);

	useEffect(() => {
		if (!inputValue.trim()) {
			setOptions([]);
			return;
		}
		setSearching(true);
		const timer = setTimeout(async () => {
			try {
				const results = await autocompleteEmployees(inputValue.trim(), 10);
				// Exclude already-selected IDs
				const selectedIds = new Set(value.map((v) => v.id));
				setOptions(results.filter((r) => !selectedIds.has(r.id)));
			} catch {
				setOptions([]);
			} finally {
				setSearching(false);
			}
		}, 250);
		return () => clearTimeout(timer);
	}, [inputValue, value]);

	return (
		<Autocomplete
			multiple
			freeSolo={false}
			options={options}
			value={value}
			inputValue={inputValue}
			onInputChange={(_e, v) => setInputValue(v)}
			onChange={(_e, newValue) => onChange(newValue as EmployeeSuggestion[])}
			getOptionLabel={getEmployeeLabel}
			isOptionEqualToValue={(opt, val) => opt.id === val.id}
			filterOptions={(x) => x}
			loading={searching}
			noOptionsText={inputValue.trim() ? 'No employees found' : 'Type a name to search'}
			renderInput={(params) => (
				<TextField
					{...(params as TextFieldProps)}
					size="small"
					placeholder="Search by name…"
					InputProps={{
						...params.InputProps,
						endAdornment: (
							<>
								{searching && <CircularProgress size={14} />}
								{params.InputProps.endAdornment}
							</>
						),
					} as TextFieldProps['InputProps']}
					data-testid="ritual-assignees-input"
				/>
			)}
			renderTags={(tagValue, getTagProps) =>
				tagValue.map((option, index) => (
					<Chip
						{...getTagProps({ index })}
						key={option.id}
						label={getEmployeeLabel(option)}
						size="small"
						sx={{ ...colors.text.primary.style }}
					/>
				))
			}
			renderOption={(props, option) => (
				<Box component="li" {...props} key={option.id}>
					<Box sx={{ display: 'flex', flexDirection: 'column' }}>
						<Typography variant="body2">{getEmployeeLabel(option)}</Typography>
						{option.email && (
							<Typography variant="caption" sx={colors.text.secondary.style}>
								{option.email}
							</Typography>
						)}
					</Box>
				</Box>
			)}
		/>
	);
}

// =============================================================================
// Department Pool Picker
// =============================================================================

interface DepartmentPoolPickerProps {
	value: DeptPoolSlot[];
	onChange: (v: DeptPoolSlot[]) => void;
}

function DepartmentPoolPicker({ value, onChange }: DepartmentPoolPickerProps) {
	const colors = useThemeColors();
	const [inputValue, setInputValue] = useState('');
	const [options, setOptions] = useState<DepartmentSuggestion[]>([]);
	const [searching, setSearching] = useState(false);

	useEffect(() => {
		if (!inputValue.trim()) {
			setOptions([]);
			return;
		}
		setSearching(true);
		const timer = setTimeout(async () => {
			try {
				const results = await autocompleteDepartments(inputValue.trim(), 10);
				const selectedIds = new Set(value.map((s) => s.dept.id));
				setOptions(results.filter((r) => !selectedIds.has(r.id)));
			} catch {
				setOptions([]);
			} finally {
				setSearching(false);
			}
		}, 250);
		return () => clearTimeout(timer);
	}, [inputValue, value]);

	const handleAdd = (_e: React.SyntheticEvent, dept: DepartmentSuggestion | null) => {
		if (!dept) return;
		onChange([...value, { dept, strategy: 'round_robin' }]);
		setInputValue('');
		setOptions([]);
	};

	const handleRemove = (deptId: string) => {
		onChange(value.filter((s) => s.dept.id !== deptId));
	};

	const handleStrategyChange = (deptId: string, strategy: AssignmentStrategy) => {
		onChange(value.map((s) => s.dept.id === deptId ? { ...s, strategy } : s));
	};

	return (
		<Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
			<Autocomplete
				freeSolo={false}
				options={options}
				value={null}
				inputValue={inputValue}
				onInputChange={(_e, v) => setInputValue(v)}
				onChange={handleAdd}
				getOptionLabel={(opt) => (opt as DepartmentSuggestion).name}
				isOptionEqualToValue={(opt, val) => opt.id === val.id}
				filterOptions={(x) => x}
				loading={searching}
				noOptionsText={inputValue.trim() ? 'No departments found' : 'Type to search departments'}
				renderInput={(params) => (
					<TextField
						{...(params as TextFieldProps)}
						size="small"
						placeholder="Search department…"
						InputProps={{
							...params.InputProps,
							endAdornment: (
								<>
									{searching && <CircularProgress size={14} />}
									{params.InputProps.endAdornment}
								</>
							),
						} as TextFieldProps['InputProps']}
						data-testid="ritual-dept-pool-input"
					/>
				)}
				renderOption={(props, option) => (
					<Box component="li" {...props} key={(option as DepartmentSuggestion).id}>
						<Typography variant="body2">{(option as DepartmentSuggestion).name}</Typography>
					</Box>
				)}
			/>

			{value.length > 0 && (
				<Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
					{value.map((slot) => (
						<Box key={slot.dept.id} sx={{
							display: 'flex', alignItems: 'center', gap: 1,
							p: 1, borderRadius: 1, border: '1px solid',
							borderColor: 'divider', ...colors.bg.active.style,
						}}>
							<Typography variant="body2" sx={{ ...colors.text.primary.style, flex: 1, fontWeight: 500 }}>
								{slot.dept.name}
							</Typography>
							<FormControl size="small" sx={{ minWidth: 140 }}>
								<Select
									value={slot.strategy}
									onChange={(e) => handleStrategyChange(slot.dept.id, e.target.value as AssignmentStrategy)}
									data-testid={`dept-pool-strategy-${slot.dept.id}`}
								>
									<MenuItem value="round_robin">Round-robin</MenuItem>
									<MenuItem value="least_assigned">Least-assigned</MenuItem>
								</Select>
							</FormControl>
							<IconButton size="small" onClick={() => handleRemove(slot.dept.id)} data-testid={`dept-pool-remove-${slot.dept.id}`}>
								<DeleteOutlineIcon fontSize="small" />
							</IconButton>
						</Box>
					))}
				</Box>
			)}
		</Box>
	);
}

// =============================================================================
// Main Page Component
// =============================================================================

export default function RitualDefinitionPage() {
	const colors = useThemeColors();
	const router = useRouter();
	const params = useParams();
	const { isLoading: authLoading, isAuthenticated } = useRequireAuth();

	const projectId = params?.id as string;
	const definitionIdParam = params?.definitionId as string;
	const isNew = definitionIdParam === 'new';

	// Data state
	const [project, setProject] = useState<Project | null>(null);
	const [existingDef, setExistingDef] = useState<RitualDefinition | null>(null);
	const [liveEvidence, setLiveEvidence] = useState<EvidenceRequirementDetail[]>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Form state
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('daily');
	const [interval, setInterval] = useState(1);
	const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]); // Mon-Fri default
	const [dayOfMonth, setDayOfMonth] = useState(1);
	const [completionWindowHours, setCompletionWindowHours] = useState(24);
	// Default timezone to user's local timezone, mapped to nearest UTC offset
	const [timezone, setTimezone] = useState(() => {
		try {
			const offsetMin = new Date().getTimezoneOffset();
			const offsetHrs = -offsetMin / 60;
			if (offsetHrs === 0) return 'UTC';
			const sign = offsetHrs > 0 ? '+' : '';
			const candidate = `UTC${sign}${offsetHrs}`;
			if (TIMEZONE_OPTIONS.some((o) => o.value === candidate)) return candidate;
			return 'UTC';
		} catch {
			return 'UTC';
		}
	});
	const [draftEvidence, setDraftEvidence] = useState<DraftEvidenceRequirement[]>([]);

	// Schedule change tracking (edit mode)
	const [scheduleChanged, setScheduleChanged] = useState(false);
	const [scheduleImpact, setScheduleImpact] = useState<ScheduleChangeImpact | null>(null);
	const [impactLoading, setImpactLoading] = useState(false);
	const [showScheduleConfirm, setShowScheduleConfirm] = useState(false);

	// Assignees
	const [selectedAssignees, setSelectedAssignees] = useState<EmployeeSuggestion[]>([]);
	// Department pools
	const [selectedDepartmentPools, setSelectedDepartmentPools] = useState<DeptPoolSlot[]>([]);

	// Track original schedule values for comparison in edit mode
	const [originalRecurrenceType, setOriginalRecurrenceType] = useState<RecurrenceType>('daily');
	const [originalInterval, setOriginalInterval] = useState(1);
	const [originalDaysOfWeek, setOriginalDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);
	const [originalDayOfMonth, setOriginalDayOfMonth] = useState(1);

	const backUrl = `/workspace/tasks/${projectId}?view=settings&tab=rituals`;

	// Load data
	useEffect(() => {
		if (authLoading || !isAuthenticated) return;

		async function load() {
			setLoading(true);
			setError(null);
			try {
				if (isNew) {
					const projectResp = await getProject(projectId);
					setProject(projectResp.project);
				} else {
					const [projectResp, defResp, evidenceResp] = await Promise.all([
						getProject(projectId),
						getRitualDefinition(definitionIdParam),
						listEvidenceRequirements(definitionIdParam),
					]);
					setProject(projectResp.project);
					setExistingDef(defResp);
					setLiveEvidence(evidenceResp);

					// Populate form from existing definition
					setName(defResp.name);
					setDescription(defResp.description);
					const defType = defResp.recurrenceRule?.type ?? 'daily';
					const defInterval = defResp.recurrenceRule?.interval ?? 1;
					const defDays = defResp.recurrenceRule?.daysOfWeek ?? [1, 2, 3, 4, 5];
					const defDayOfMonth = defResp.recurrenceRule?.dayOfMonth ?? 1;
					setRecurrenceType(defType);
					setInterval(defInterval);
					setDaysOfWeek(defDays);
					setDayOfMonth(defDayOfMonth);
					setCompletionWindowHours(defResp.completionWindowHours);
					setTimezone(defResp.timezone);
					// Load existing assignees as placeholder objects (names resolved on re-search)
					if (defResp.defaultAssigneeIds.length > 0) {
						setSelectedAssignees(
							defResp.defaultAssigneeIds.map((id) => ({
								id,
								givenName: id.slice(0, 8),
								familyName: '…',
								email: '',
							}))
						);
					}
					// Load existing department pools
					if (defResp.defaultDepartmentPools.length > 0) {
						setSelectedDepartmentPools(
							defResp.defaultDepartmentPools.map((p) => ({
								dept: { id: p.departmentId, name: p.departmentName, description: '' },
								strategy: p.assignmentStrategy,
							}))
						);
					}
					// Persist original schedule for change detection
					setOriginalRecurrenceType(defType);
					setOriginalInterval(defInterval);
					setOriginalDaysOfWeek(defDays);
					setOriginalDayOfMonth(defDayOfMonth);
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Failed to load');
			} finally {
				setLoading(false);
			}
		}

		load();
	}, [authLoading, isAuthenticated, projectId, definitionIdParam, isNew]);

	// Detect schedule changes in edit mode and fetch impact preview
	useEffect(() => {
		if (isNew || !existingDef) return;

		const changed =
			recurrenceType !== originalRecurrenceType ||
			interval !== originalInterval ||
			(recurrenceType === 'weekly' && JSON.stringify([...daysOfWeek].sort()) !== JSON.stringify([...originalDaysOfWeek].sort())) ||
			(recurrenceType === 'monthly' && dayOfMonth !== originalDayOfMonth);

		setScheduleChanged(changed);

		if (!changed) {
			setScheduleImpact(null);
			return;
		}

		// Fetch impact preview with debounce
		setImpactLoading(true);
		const timer = setTimeout(async () => {
			try {
				const rule: RecurrenceRule = {
					type: recurrenceType,
					interval,
					daysOfWeek: recurrenceType === 'weekly' ? daysOfWeek : [],
					dayOfMonth: recurrenceType === 'monthly' ? dayOfMonth : 0,
				};
				const impact = await getScheduleChangeImpact(existingDef.id, rule);
				setScheduleImpact(impact);
			} catch {
				setScheduleImpact(null);
			} finally {
				setImpactLoading(false);
			}
		}, 500);
		return () => clearTimeout(timer);
	}, [isNew, existingDef, recurrenceType, interval, daysOfWeek, dayOfMonth, originalRecurrenceType, originalInterval, originalDaysOfWeek, originalDayOfMonth]);

	const handleSave = useCallback(async () => {
		if (!name.trim()) {
			setError('Name is required');
			return;
		}
		if (recurrenceType === 'weekly' && daysOfWeek.length === 0) {
			setError('Select at least one day of the week');
			return;
		}

		setSaving(true);
		setError(null);
		try {
			const recurrenceRule: RecurrenceRule = {
				type: recurrenceType,
				interval,
				daysOfWeek: recurrenceType === 'weekly' ? daysOfWeek : [],
				dayOfMonth: recurrenceType === 'monthly' ? dayOfMonth : 0,
			};

			if (isNew) {
				const def = await createRitualDefinition({
					projectId,
					name: name.trim(),
					description: description.trim(),
					recurrenceRule,
					completionWindowHours,
					timezone,
					defaultAssigneeIds: selectedAssignees.map((a) => a.id),
					defaultDepartmentPools: selectedDepartmentPools.map((s) => ({
						departmentId: s.dept.id,
						assignmentStrategy: s.strategy,
					})),
				});
				// Save any draft evidence requirements
				for (const draft of draftEvidence) {
					if (!draft.name.trim() || draft.evidenceTypes.length === 0) continue;
					try {
						await createEvidenceRequirement({
							ritualDefinitionId: def.id,
							name: draft.name.trim(), description: draft.description.trim(),
							evidenceTypes: draft.evidenceTypes, isRequired: draft.isRequired,
							approvalMode: draft.approvalMode, deadlineOffsetHours: draft.deadlineOffsetHours,
						});
					} catch {
						// non-fatal: definition saved, evidence can be added later
					}
				}
				router.push(`/workspace/tasks/${projectId}/rituals/${def.id}`);
			} else {
				// If schedule changed, require confirmation and use dedicated schedule change API
				if (scheduleChanged && !showScheduleConfirm) {
					setShowScheduleConfirm(true);
					setSaving(false);
					return;
				}

				if (scheduleChanged) {
					// Apply schedule change via the atomic schedule change API
					await changeRitualDefinitionSchedule(
						existingDef!.id,
						recurrenceRule,
						true
					);
				}

				// Update other fields (name, description, etc.)
				await updateRitualDefinition({
					ritualDefinitionId: existingDef!.id,
					name: name.trim(),
					description: description.trim(),
					recurrenceRule: scheduleChanged ? undefined : recurrenceRule,
					completionWindowHours,
					timezone,
					defaultAssigneeIds: selectedAssignees.map((a) => a.id),
					defaultDepartmentPools: selectedDepartmentPools.map((s) => ({
						departmentId: s.dept.id,
						assignmentStrategy: s.strategy,
					})),
				});
				setShowScheduleConfirm(false);
				// Navigate back to confirm save
				router.push(backUrl);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to save');
		} finally {
			setSaving(false);
		}
	}, [
		name, description, recurrenceType, interval, daysOfWeek, dayOfMonth,
		completionWindowHours, timezone, draftEvidence, isNew, projectId,
		existingDef, router, backUrl, scheduleChanged, showScheduleConfirm,
		selectedAssignees, selectedDepartmentPools,
	]);

	if (authLoading || loading) {
		return (
			<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
				<CircularProgress />
			</Box>
		);
	}

	if (!isAuthenticated) return null;

	return (
		<Box sx={{ minHeight: '100vh', ...colors.bg.default.style }}>
			{/* Header */}
			<Box sx={{
				borderBottom: 1, ...colors.border.default.style, ...colors.bg.paper.style,
				px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
				position: 'sticky', top: 0, zIndex: 10,
			}}>
				<Box>
					<Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} sx={{ mb: 0.5 }}>
						<Link component={NextLink} href="/workspace" underline="hover" sx={{ ...colors.text.secondary.style, fontSize: '0.8rem' }}>
							Workspace
						</Link>
						{project && (
							<Link component={NextLink} href={`/workspace/tasks/${projectId}`} underline="hover" sx={{ ...colors.text.secondary.style, fontSize: '0.8rem' }}>
								{project.name}
							</Link>
						)}
						<Link component={NextLink} href={backUrl} underline="hover" sx={{ ...colors.text.secondary.style, fontSize: '0.8rem' }}>
							Settings › Rituals
						</Link>
						<Typography sx={{ ...colors.text.primary.style, fontSize: '0.8rem', fontWeight: 500 }}>
							{isNew ? 'New Ritual' : (name || 'Edit Ritual')}
						</Typography>
					</Breadcrumbs>
					<Typography variant="h6" sx={{ ...colors.text.primary.style, fontWeight: 600 }}>
						{isNew ? 'Create Ritual Definition' : 'Edit Ritual Definition'}
					</Typography>
					<Typography variant="body2" sx={{ ...colors.text.secondary.style, mt: 0.5 }} data-testid="ritual-definition-template-copy">
						This page edits the reusable ritual template. Live submissions, reviews, and missed runs stay on the project operational surfaces.
					</Typography>
				</Box>
				<Box sx={{ display: 'flex', gap: 1 }}>
					<Button variant="outlined" onClick={() => router.push(backUrl)} disabled={saving} data-testid="cancel-ritual-btn">
						Cancel
					</Button>
					<Button
						variant="contained"
						startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
						onClick={handleSave}
						disabled={saving || !name.trim()}
						data-testid="save-ritual-btn"
					>
						{isNew ? 'Create' : 'Save changes'}
					</Button>
				</Box>
			</Box>

			{/* Content */}
			<Box sx={{ maxWidth: 1280, mx: 'auto', px: 3, py: 4 }}>
				{error && (
					<Alert severity="error" onClose={() => setError(null)} data-testid="ritual-error-alert" sx={{ mb: 3 }}>
						{error}
					</Alert>
				)}

				<Alert severity="info" sx={{ mb: 3 }} data-testid="ritual-template-management-alert">
					Template management happens here. To act on a generated ritual run, return to the project and open Today, Review, Calendar, Health, or Worklist.
				</Alert>

				{/* 2-column layout on wide screens */}
				<Box sx={{
					display: 'grid',
					gridTemplateColumns: { xs: '1fr', lg: '3fr 2fr' },
					gap: 3,
					alignItems: 'start',
				}}>
					{/* ── Left column: Basic Info + Evidence Requirements ── */}
					<Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
						{/* Section 1: Basic Information */}
						<Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
							<Typography variant="subtitle1" sx={{ ...colors.text.primary.style, fontWeight: 600, mb: 2 }}>
								Basic Information
							</Typography>
							<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
								<TextField
									label="Ritual name" fullWidth
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder="e.g. Daily Cold Chain Check, Weekly Permission Audit"
									inputProps={{ 'data-testid': 'ritual-name-input' }}
								/>
								<Box>
									<Typography variant="body2" sx={{ ...colors.text.primary.style, fontWeight: 500, mb: 0.5 }}>
										Description / Instructions
									</Typography>
									<Typography variant="caption" sx={{ ...colors.text.secondary.style, mb: 1, display: 'block' }}>
										Standing Operating Procedure shown to workers on every instance.
										Supports <strong>bold</strong>, <em>italic</em>, lists, and quotes.
									</Typography>
									<DescriptionEditor value={description} onChange={setDescription} />
								</Box>
							</Box>
						</Paper>

						{/* Section 4: Evidence Requirements */}
						<Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
							<Typography variant="subtitle1" sx={{ ...colors.text.primary.style, fontWeight: 600, mb: 0.5 }}>
								Evidence Requirements
							</Typography>
							<EvidenceRequirementEditor
								ritualDefinitionId={isNew ? null : (existingDef?.id ?? null)}
								initial={liveEvidence}
								onChange={setDraftEvidence}
							/>
						</Paper>
					</Box>

					{/* ── Right column: Schedule + Timing ── */}
					<Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
						{/* Section 2: Recurrence Schedule */}
						<Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
							<Typography variant="subtitle1" sx={{ ...colors.text.primary.style, fontWeight: 600, mb: 2 }}>
								Recurrence Schedule
							</Typography>
							<RecurrenceForm
								recurrenceType={recurrenceType} onRecurrenceTypeChange={setRecurrenceType}
								interval={interval} onIntervalChange={setInterval}
								daysOfWeek={daysOfWeek} onDaysOfWeekChange={setDaysOfWeek}
								dayOfMonth={dayOfMonth} onDayOfMonthChange={setDayOfMonth}
							/>

							{/* Schedule change impact warning — edit mode only */}
							{!isNew && scheduleChanged && (
								<Alert
									severity="warning"
									icon={false}
									sx={{ mt: 2 }}
									data-testid="schedule-change-warning"
								>
									<Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
										⚠️ Schedule change detected
									</Typography>
									<Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
										Changing the recurrence pattern will affect existing future task instances.
									</Typography>
									{impactLoading ? (
										<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
											<CircularProgress size={14} />
											<Typography variant="caption">Loading impact preview…</Typography>
										</Box>
									) : scheduleImpact ? (
										<Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
											<Chip label={`${scheduleImpact.instancesToRemove} to remove`} size="small" color="error" variant="outlined" />
											<Chip label={`${scheduleImpact.instancesToDetach} to detach`} size="small" color="warning" variant="outlined" />
											<Chip label={`${scheduleImpact.instancesToCreate} new`} size="small" color="success" variant="outlined" />
										</Box>
									) : null}
									<Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
										You will be asked to confirm this change when saving.
									</Typography>
								</Alert>
							)}

							{/* Confirmation dialog for schedule change */}
							{showScheduleConfirm && (
								<Alert
									severity="warning"
									sx={{ mt: 2 }}
									data-testid="schedule-change-confirm-alert"
									action={
										<Box sx={{ display: 'flex', gap: 1, flexDirection: 'column' }}>
											<Button size="small" color="warning" variant="contained" onClick={handleSave} disabled={saving}>
												{saving ? <CircularProgress size={14} /> : 'Confirm & Save'}
											</Button>
											<Button size="small" onClick={() => setShowScheduleConfirm(false)} disabled={saving}>
												Cancel
											</Button>
										</Box>
									}
								>
									<Typography variant="body2" sx={{ fontWeight: 600 }}>
										Confirm schedule change?
									</Typography>
									<Typography variant="caption">
										Untouched future instances will be removed. Touched instances become standalone tasks.
									</Typography>
								</Alert>
							)}
						</Paper>

						{/* Section 3: Completion Window & Timezone */}
						<Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
							<Typography variant="subtitle1" sx={{ ...colors.text.primary.style, fontWeight: 600, mb: 2 }}>
								Completion Window &amp; Timezone
							</Typography>
							<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
								<Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
									<Typography variant="body2" sx={colors.text.secondary.style}>Workers have</Typography>
									<TextField
										type="number" size="small" sx={{ width: 80 }}
										value={completionWindowHours}
										onChange={(e) => setCompletionWindowHours(Math.max(1, parseInt(e.target.value) || 1))}
										inputProps={{ min: 1, 'data-testid': 'ritual-completion-window-input' }}
									/>
									<Typography variant="body2" sx={colors.text.secondary.style}>
										hours from scheduled time to complete
									</Typography>
								</Box>
								<Typography variant="caption" sx={{ ...colors.text.secondary.style, mt: -1.5 }}>
									{completionWindowHours < 24
										? `${completionWindowHours}h window`
										: completionWindowHours === 24
										? '1-day window'
										: `${(completionWindowHours / 24).toFixed(1)}-day window`}
								</Typography>
								<FormControl size="small" fullWidth>
									<InputLabel>Timezone</InputLabel>
									<Select
										value={timezone}
										onChange={(e) => setTimezone(e.target.value)}
										label="Timezone"
										data-testid="ritual-timezone-select"
									>
										{TIMEZONE_OPTIONS.map((opt) => (
											<MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
										))}
									</Select>
								</FormControl>
							</Box>
						</Paper>

						{/* Section: Default Assignees */}
						<Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
							<Typography variant="subtitle1" sx={{ ...colors.text.primary.style, fontWeight: 600, mb: 0.5 }}>
								Default Assignees
							</Typography>
							<Typography variant="caption" sx={{ ...colors.text.secondary.style, mb: 1.5, display: 'block' }}>
								These employees are assigned to every new instance when it is generated.
								Each instance always gets a concrete assignee — search and add individuals here.
							</Typography>
							<AssigneePicker value={selectedAssignees} onChange={setSelectedAssignees} />
							{selectedAssignees.length === 0 && (
								<Typography variant="caption" sx={{ ...colors.text.secondary.style, mt: 1, display: 'block' }}>
									No default assignees — instances will be unassigned until manually assigned.
								</Typography>
							)}
						</Paper>

						{/* Section: Department Pools */}
						<Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
							<Typography variant="subtitle1" sx={{ ...colors.text.primary.style, fontWeight: 600, mb: 0.5 }}>
								Department Pools
							</Typography>
							<Typography variant="caption" sx={{ ...colors.text.secondary.style, mb: 1.5, display: 'block' }}>
								Each instance generated from this ritual will be assigned one member from each pool department.
								<br />
								<strong>Round-robin</strong>: rotates through active members in order.
								<strong>Least-assigned</strong>: picks the member with fewest recent ritual assignments.
							</Typography>
							<DepartmentPoolPicker value={selectedDepartmentPools} onChange={setSelectedDepartmentPools} />
						</Paper>

						{/* Save / Cancel inline on right column (lg screens) */}
						<Box sx={{ display: { xs: 'none', lg: 'flex' }, gap: 1, justifyContent: 'flex-end' }}>
							<Button variant="outlined" onClick={() => router.push(backUrl)} disabled={saving}>
								Cancel
							</Button>
							<Button
								variant="contained"
								startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
								onClick={handleSave}
								disabled={saving || !name.trim()}
								data-testid="save-ritual-btn-bottom"
							>
								{isNew ? 'Create ritual' : 'Save changes'}
							</Button>
						</Box>
					</Box>
				</Box>

				{/* Bottom save row — visible only on small screens */}
				<Box sx={{ display: { xs: 'flex', lg: 'none' }, justifyContent: 'flex-end', gap: 1, pt: 3, pb: 4 }}>
					<Button variant="outlined" onClick={() => router.push(backUrl)} disabled={saving}>
						Cancel
					</Button>
					<Button
						variant="contained"
						startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
						onClick={handleSave}
						disabled={saving || !name.trim()}
						data-testid="save-ritual-btn-bottom"
					>
						{isNew ? 'Create ritual' : 'Save changes'}
					</Button>
				</Box>
			</Box>
		</Box>
	);
}
