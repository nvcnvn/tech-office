'use client';

/**
 * Feature 043 — the read-only overlay that shows a ritual's written procedure.
 *
 * It is a Dialog and not a route, and that is load bearing rather than cosmetic. The
 * surfaces that open it — the instance detail page, the evidence capture form, the review
 * queue row — all hold state a reader would lose if they navigated away: an attached
 * photo, a typed note, a typed rejection reason, a position in the queue. Because the
 * dialog portals over the surface instead of replacing it, that state cannot be discarded
 * by a component that was never unmounted. Converting this to a route later reintroduces
 * exactly the loss this design removes.
 *
 * It deliberately does NOT reuse DocumentEditor: that component carries save mutations,
 * embeds, a markdown mode, version history and its own getDocument call. Every one of
 * those is either forbidden here or re-enters the docs access path — and the whole point
 * is that this reader may have no docs access at all. Content arrives from
 * CollaborationService.GetRitualProcedure and is rendered with a TipTap editor that can
 * never be edited.
 */

import { useEffect, useState } from 'react';
import {
	Alert,
	Box,
	Button,
	Chip,
	CircularProgress,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	Typography,
	useTheme,
} from '@mui/material';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { getRitualProcedure, type RitualProcedure } from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';

interface ProcedureDialogProps {
	open: boolean;
	onClose: () => void;
	/** The definition, not the instance — an instance resolves its procedure through it. */
	ritualDefinitionId: string;
	/**
	 * The title already known from `RitualDefinition.procedure`, shown while the content
	 * loads so the dialog never opens with an empty header. Surfaces that do not hold the
	 * definition (the review queue) omit it and get the title from the fetch.
	 */
	title?: string;
}

/** The content shape a procedure with no body still needs, so TipTap has something to render. */
const EMPTY_DOC = { type: 'doc', content: [] };

function parseContent(contentJson: string): object {
	if (!contentJson) return EMPTY_DOC;
	try {
		return JSON.parse(contentJson) as object;
	} catch {
		return EMPTY_DOC;
	}
}

export default function ProcedureDialog({
	open,
	onClose,
	ritualDefinitionId,
	title,
}: ProcedureDialogProps) {
	const colors = useThemeColors();
	const theme = useTheme();

	const [loading, setLoading] = useState(false);
	const [failed, setFailed] = useState(false);
	const [procedure, setProcedure] = useState<RitualProcedure | undefined>();
	const [contentJson, setContentJson] = useState('');

	// Fetched only when the dialog is actually opened. A ritual instance page that nobody
	// opens the procedure on pays nothing for the entry point beyond the label it already
	// has from the definition.
	useEffect(() => {
		if (!open) return;
		let cancelled = false;

		setLoading(true);
		setFailed(false);
		getRitualProcedure(ritualDefinitionId)
			.then((res) => {
				if (cancelled) return;
				setProcedure(res.procedure);
				setContentJson(res.contentJson);
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [open, ritualDefinitionId]);

	const editor = useEditor(
		{
			immediatelyRender: false,
			extensions: [
				StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
				Underline,
				Link.configure({ openOnClick: false }),
			],
			content: parseContent(contentJson),
			// Never editable, on any surface, for any reader. Editing a document stays on
			// the documents feature, where the reader's own access decides.
			editable: false,
		},
		[contentJson]
	);

	// `undefined` means no procedure was ever attached; a present procedure with
	// `isAvailable: false` means one is attached and can no longer be resolved. These are
	// different states and are rendered differently — collapsing them would tell a worker
	// there was never a procedure for a ritual that has one.
	const unavailable = !loading && (failed || (procedure !== undefined && !procedure.isAvailable));
	const absent = !loading && !failed && procedure === undefined;
	const heading = procedure?.title || title || 'Procedure';

	return (
		<Dialog
			open={open}
			onClose={onClose}
			fullWidth
			maxWidth="md"
			data-testid="procedure-dialog"
		>
			<DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
				<Box component="span" data-testid="procedure-dialog-title">
					{heading}
				</Box>
				{procedure?.status === 'archived' && (
					<Chip size="small" label="Archived" data-testid="procedure-dialog-archived" />
				)}
				{procedure?.status === 'outdated' && (
					<Chip size="small" label="Outdated" data-testid="procedure-dialog-outdated" />
				)}
			</DialogTitle>

			<DialogContent dividers>
				{loading && (
					<Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
						<CircularProgress size={24} />
					</Box>
				)}

				{unavailable && (
					<Alert severity="warning" data-testid="procedure-dialog-unavailable">
						This ritual has a procedure attached, but the document is no longer
						available. Carry on — evidence can still be submitted and reviewed.
					</Alert>
				)}

				{absent && (
					<Typography variant="body2" sx={{ ...colors.text.secondary.style }}>
						This ritual has no procedure attached.
					</Typography>
				)}

				{!loading && !unavailable && !absent && (
					<Box
						data-testid="procedure-dialog-content"
						sx={{
							'& .ProseMirror': {
								outline: 'none',
								lineHeight: 1.8,
								...colors.text.primary.style,
							},
							'& .ProseMirror p': { margin: 0, lineHeight: 1.8 },
							'& .ProseMirror h1': { fontSize: '2em', fontWeight: 600, margin: '0.67em 0' },
							'& .ProseMirror h2': { fontSize: '1.5em', fontWeight: 600, margin: '0.75em 0' },
							'& .ProseMirror h3': { fontSize: '1.17em', fontWeight: 600, margin: '0.83em 0' },
							'& .ProseMirror ul, & .ProseMirror ol': {
								paddingLeft: '1.5em',
								margin: '0 0 1em 0',
							},
							'& .ProseMirror blockquote': {
								borderLeft: `3px solid ${theme.palette.divider}`,
								paddingLeft: '1em',
								margin: '1em 0',
								...colors.text.secondary.style,
							},
							'& .ProseMirror code': {
								...colors.bg.paper.style,
								padding: '0.2em 0.4em',
								borderRadius: '3px',
								fontSize: '0.9em',
							},
							'& .ProseMirror pre': {
								...colors.bg.paper.style,
								padding: '1em',
								borderRadius: '4px',
								overflow: 'auto',
							},
						}}
					>
						<EditorContent editor={editor} />
					</Box>
				)}
			</DialogContent>

			<DialogActions>
				<Button onClick={onClose} data-testid="procedure-dialog-close">
					Close
				</Button>
			</DialogActions>
		</Dialog>
	);
}
