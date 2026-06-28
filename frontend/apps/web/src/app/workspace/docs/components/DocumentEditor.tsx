/**
 * DocumentEditor Component
 * Rich text editor for document content using TipTap
 * Supports WYSIWYG and raw markdown modes with formatting toolbar
 */

'use client';

import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import {
	Box,
	Typography,
	TextField,
	Button,
	CircularProgress,
	Alert,
	IconButton,
	ToggleButton,
	ToggleButtonGroup,
	Tooltip,
	Divider,
	Paper,
} from '@mui/material';
import {
	FormatBold as BoldIcon,
	FormatItalic as ItalicIcon,
	FormatUnderlined as UnderlineIcon,
	Code as CodeIcon,
	FormatListBulleted as BulletListIcon,
	FormatListNumbered as NumberedListIcon,
	FormatQuote as BlockquoteIcon,
	DataObject as CodeBlockIcon,
} from '@mui/icons-material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { useTheme } from '@mui/material/styles';
import { updateDocument, type Document, createEmbed, getDocument, getAuthToken, type CreateEmbedParams, type SectionEmbed } from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';
import {
	extractCanonicalResourceLinks,
	getCanonicalLinkPreviewDisplay,
	isCanonicalResourceLink,
	type CanonicalLinkPreviewDisplay,
	type CanonicalPreviewResponse,
} from '@tech-office/links';
import { EmbedNode } from './EmbedNode';
import LineNumberSidebar, { type CitedLineRange } from './LineNumberSidebar';
import { EMBED_MARKDOWN_TOKEN_RE } from './lineNumberModel';

interface DocumentEditorProps {
	document: Document;
	isEditing: boolean;
	onSaved: () => void;
	citedLineRanges?: CitedLineRange[];
	onOpenCitations?: () => void;
}

type EditorMode = 'wysiwyg' | 'markdown';

// Type for TipTap JSON node structure
interface TipTapNode {
	type: string;
	attrs?: Record<string, unknown>;
	content?: TipTapNode[];
	[key: string]: unknown;
}

function isUUID(s: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

type ParsedCitationLink = {
	targetIdentifier: string;
	targetLineStart: number;
	targetLineEnd: number;
	targetVersion?: number; // Version number if specified in URL
	citationUrl: string; // Full URL for reference
};

function CanonicalLinkPreviewList({ urls }: { urls: string[] }) {
	const theme = useTheme();
	const urlsKey = useMemo(() => urls.join('\n'), [urls]);
	const [items, setItems] = useState<CanonicalLinkPreviewDisplay[]>([]);

	useEffect(() => {
		if (urls.length === 0) {
			setItems([]);
			return;
		}
		let cancelled = false;

		async function loadPreviews() {
			const token = await getAuthToken().catch(() => null);
			const nextItems = await Promise.all(
				urls.map(async (url) => {
					try {
						const response = await fetch(
							`${process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:18080'}/api/linking/preview?url=${encodeURIComponent(url)}`,
							{
								headers: token ? { Authorization: `Bearer ${token}` } : undefined,
								cache: 'no-store',
							}
						);
						if (!response.ok) {
							return getCanonicalLinkPreviewDisplay(null, url);
						}
						const payload = (await response.json()) as CanonicalPreviewResponse;
						return getCanonicalLinkPreviewDisplay(payload.preview ?? null, url);
					} catch {
						return getCanonicalLinkPreviewDisplay(null, url);
					}
				})
			);
			if (!cancelled) {
				setItems(nextItems.filter((item): item is CanonicalLinkPreviewDisplay => Boolean(item)));
			}
		}

		void loadPreviews();
		return () => {
			cancelled = true;
		};
	}, [urls, urlsKey]);

	if (items.length === 0) {
		return null;
	}

	return (
		<Box sx={{ mt: 3 }}>
			<Typography variant="caption" sx={{ display: 'block', mb: 1, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'text.secondary', fontWeight: 700 }}>
				Linked resources
			</Typography>
			<Box sx={{ display: 'grid', gap: 1 }}>
				{items.map((item) => (
					<Box
						key={item.href}
						component="a"
						href={item.href}
						sx={{
							display: 'block',
							px: 1.5,
							py: 1.25,
							borderRadius: 1,
							border: '1px solid',
							borderColor: theme.palette.divider,
							backgroundColor: theme.palette.action.hover,
							textDecoration: 'none',
							'&:hover': {
								borderColor: theme.palette.primary.main,
							},
						}}
					>
						<Typography variant="caption" sx={{ display: 'block', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'primary.main', fontWeight: 700 }}>
							{item.badge}
						</Typography>
						<Typography variant="subtitle2" sx={{ mt: 0.5, color: 'text.primary', fontWeight: 700 }}>
							{item.title}
						</Typography>
						{item.subtitle ? (
							<Typography variant="body2" sx={{ mt: 0.25, color: 'text.secondary' }}>
								{item.subtitle}
							</Typography>
						) : null}
					</Box>
				))}
			</Box>
		</Box>
	);
}

function parseCitationLink(text: string): ParsedCitationLink | null {
	// Accept URLs like:
	// - http(s)://.../workspace/docs?slug={slug}#L10
	// - /workspace/docs?slug={slug}#L10-L15
	// - /workspace/docs?doc={uuid}#L10
	// - /workspace/docs/{slug}#L10 (legacy)
	const urlMatch = text.match(
		/\/workspace\/docs(?:\?[^#\s]*?(?:slug|doc)=([^&#\s]+)[^#\s]*|\/([^#\s]+))#L(\d+)(?:-L?(\d+))?/i
	);
	if (!urlMatch) return null;

	const targetIdentifier = decodeURIComponent(urlMatch[1] || urlMatch[2] || '');
	const targetLineStart = parseInt(urlMatch[3], 10);
	const targetLineEnd = urlMatch[4] ? parseInt(urlMatch[4], 10) : targetLineStart;

	if (!targetIdentifier || Number.isNaN(targetLineStart) || Number.isNaN(targetLineEnd)) return null;
	
	// Extract version parameter if present (e.g., &v=3)
	const versionMatch = text.match(/[?&]v=(\d+)/);
	const targetVersion = versionMatch ? parseInt(versionMatch[1], 10) : undefined;
	
	// Extract clean URL for citation (without protocol/domain)
	const citationUrl = text.match(/(\/workspace\/docs[^\s]*)/) ?.[1] || text;
	
	return { targetIdentifier, targetLineStart, targetLineEnd, targetVersion, citationUrl };
}

function buildEmbedUrlFromAttrs(attrs: {
	embedId?: string;
	citationUrl?: string;
	targetDocumentId?: string;
	targetLineStart?: number;
	targetLineEnd?: number;
	targetVersion?: number;
}): string | null {
	if (attrs.citationUrl) return attrs.citationUrl;
	if (!attrs.targetDocumentId || !attrs.targetLineStart) return null;
	const lineRange = attrs.targetLineEnd && attrs.targetLineEnd !== attrs.targetLineStart
		? `L${attrs.targetLineStart}-L${attrs.targetLineEnd}`
		: `L${attrs.targetLineStart}`;
	const versionParam = attrs.targetVersion ? `&v=${attrs.targetVersion}` : '';
	return `/workspace/docs?doc=${attrs.targetDocumentId}${versionParam}#${lineRange}`;
}

// Convert TipTap JSON to Markdown
function jsonToMarkdown(jsonStr: string): string {
	try {
		const doc = JSON.parse(jsonStr);
		return nodeToMarkdown(doc);
	} catch {
		return '';
	}
}

function nodeToMarkdown(node: unknown): string {
	if (!node || typeof node !== 'object') return '';

	const n = node as Record<string, unknown>;

	// Hard break (line break within paragraph)
	if (n.type === 'hardBreak') {
		return '\n';
	}

	// Embed node (custom token for round-trip across modes)
	if (n.type === 'embed') {
		const attrs = n.attrs as { 
			embedId?: string;
			citationUrl?: string;
			targetDocumentId?: string;
			targetLineStart?: number;
			targetLineEnd?: number;
		} | undefined;
		
		// Prefer citationUrl if available (pending or URL-based embed)
		if (attrs?.citationUrl) {
			return `{{embed:${attrs.citationUrl}}}\n`;
		}
		
		// Fallback: Generate URL from targetDocumentId and line range
		if (attrs?.targetDocumentId && attrs?.targetLineStart) {
			const lineRange = attrs.targetLineEnd && attrs.targetLineEnd !== attrs.targetLineStart
				? `L${attrs.targetLineStart}-L${attrs.targetLineEnd}`
				: `L${attrs.targetLineStart}`;
			const url = `/workspace/docs?doc=${attrs.targetDocumentId}#${lineRange}`;
			return `{{embed:${url}}}\n`;
		}
		
		return '';
	}

	// Text node with marks
	if (n.type === 'text' && typeof n.text === 'string') {
		let text = n.text;
		const marks = n.marks as Array<{ type: string }> | undefined;

		if (marks) {
			// Apply marks in order: code, bold, italic, underline
			if (marks.some(m => m.type === 'code')) {
				text = `\`${text}\``;
			}
			if (marks.some(m => m.type === 'bold')) {
				text = `**${text}**`;
			}
			if (marks.some(m => m.type === 'italic')) {
				text = `*${text}*`;
			}
			if (marks.some(m => m.type === 'underline')) {
				text = `<u>${text}</u>`;
			}
		}
		return text;
	}

	// Block nodes with content
	if (Array.isArray(n.content)) {
		const content = n.content.map(nodeToMarkdown).join('');

		switch (n.type) {
			case 'doc':
				return content;
			case 'paragraph':
				// Preserve empty paragraphs as blank lines
				return (content.trim() ? content : '') + '\n';
			case 'heading': {
				const level = (n.attrs as { level?: number })?.level || 1;
				return '#'.repeat(level) + ' ' + content + '\n';
			}
			case 'bulletList':
				return content + '\n';
			case 'orderedList':
				return content + '\n';
			case 'listItem':
				return '- ' + content.trim() + '\n';
			case 'blockquote':
				return '> ' + content.replace(/\n/g, '\n> ').trim() + '\n';
			case 'codeBlock':
				return '```\n' + content.trim() + '\n```\n';
			default:
				return content;
		}
	}

	return '';
}

// Convert Markdown to TipTap JSON
function markdownToJson(markdown: string, opts?: { embedIdByUrl?: Record<string, string> }): string {
	const lines = markdown.split('\n');
	const content: unknown[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		// Empty lines create empty paragraphs (preserve line breaks)
		if (!line.trim()) {
			// Only add empty paragraph if previous wasn't empty
			if (content.length > 0) {
				const lastNode = content[content.length - 1] as Record<string, unknown>;
				if (lastNode.type !== 'paragraph' ||
					(Array.isArray(lastNode.content) && lastNode.content.length > 0)) {
					content.push({
						type: 'paragraph',
						content: [],
					});
				}
			}
			i++;
			continue;
		}

		// Embed token: {{embed:/workspace/docs?slug=xyz#L10-L15}}
		const embedTokenMatch = line.trim().match(EMBED_MARKDOWN_TOKEN_RE);
		if (embedTokenMatch) {
			const citationUrl = embedTokenMatch[1];
			
			// Parse the URL to extract target information
			const parsed = parseCitationLink(citationUrl);
			const existingEmbedId = opts?.embedIdByUrl?.[citationUrl];
			
			content.push({
				type: 'embed',
				attrs: {
					citationUrl: citationUrl, // Store URL for reference
					...(existingEmbedId ? { embedId: existingEmbedId } : {}),
					// If we can parse it, include target info for rendering
					...(parsed ? {
						targetLineStart: parsed.targetLineStart,
						targetLineEnd: parsed.targetLineEnd,
					} : {}),
				},
			});
			i++;
			continue;
		}

		// Code block
		if (line.startsWith('```')) {
			const codeLines: string[] = [];
			i++;
			while (i < lines.length && !lines[i].startsWith('```')) {
				codeLines.push(lines[i]);
				i++;
			}
			content.push({
				type: 'codeBlock',
				content: [{ type: 'text', text: codeLines.join('\n') }],
			});
			i++;
			continue;
		}

		// Heading
		const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
		if (headingMatch) {
			const level = headingMatch[1].length;
			const text = headingMatch[2];
			content.push({
				type: 'heading',
				attrs: { level },
				content: parseInlineMarkdown(text),
			});
			i++;
			continue;
		}

		// Blockquote
		if (line.startsWith('> ')) {
			const quoteLines: string[] = [];
			while (i < lines.length && lines[i].startsWith('> ')) {
				quoteLines.push(lines[i].substring(2));
				i++;
			}
			content.push({
				type: 'blockquote',
				content: [
					{
						type: 'paragraph',
						content: parseInlineMarkdown(quoteLines.join(' ')),
					},
				],
			});
			continue;
		}

		// List item
		if (line.match(/^[-*]\s+/)) {
			const listItems: string[] = [];
			while (i < lines.length && lines[i].match(/^[-*]\s+/)) {
				listItems.push(lines[i].replace(/^[-*]\s+/, ''));
				i++;
			}
			content.push({
				type: 'bulletList',
				content: listItems.map(item => ({
					type: 'listItem',
					content: [
						{
							type: 'paragraph',
							content: parseInlineMarkdown(item),
						},
					],
				})),
			});
			continue;
		}

		// Regular paragraph
		const paragraphLines: string[] = [];
		while (
			i < lines.length &&
			lines[i].trim() &&
			!lines[i].match(/^(#{1,3}\s|[-*]\s|>\s|```)/) &&
			!EMBED_MARKDOWN_TOKEN_RE.test(lines[i].trim())
		) {
			paragraphLines.push(lines[i]);
			i++;
		}
		if (paragraphLines.length > 0) {
			// Build content with hard breaks between lines
			const paragraphContent: unknown[] = [];
			for (let j = 0; j < paragraphLines.length; j++) {
				paragraphContent.push(...parseInlineMarkdown(paragraphLines[j]));
				if (j < paragraphLines.length - 1) {
					paragraphContent.push({ type: 'hardBreak' });
				}
			}
			content.push({
				type: 'paragraph',
				content: paragraphContent,
			});
		}
	}

	return JSON.stringify({
		type: 'doc',
		content: content.length > 0 ? content : [{ type: 'paragraph', content: [] }],
	});
}

// Parse inline markdown (bold, italic, code, underline)
function parseInlineMarkdown(text: string): unknown[] {
	if (!text) return [];

	const parts: unknown[] = [];
	let current = '';
	let i = 0;

	while (i < text.length) {
		// Bold: **text**
		if (text.substring(i, i + 2) === '**') {
			if (current) {
				parts.push({ type: 'text', text: current });
				current = '';
			}
			i += 2;
			let boldText = '';
			while (i < text.length && text.substring(i, i + 2) !== '**') {
				boldText += text[i];
				i++;
			}
			if (i < text.length) {
				parts.push({ type: 'text', text: boldText, marks: [{ type: 'bold' }] });
				i += 2;
			}
			continue;
		}

		// Italic: *text*
		if (text[i] === '*' && text[i + 1] !== '*') {
			if (current) {
				parts.push({ type: 'text', text: current });
				current = '';
			}
			i++;
			let italicText = '';
			while (i < text.length && text[i] !== '*') {
				italicText += text[i];
				i++;
			}
			if (i < text.length) {
				parts.push({ type: 'text', text: italicText, marks: [{ type: 'italic' }] });
				i++;
			}
			continue;
		}

		// Inline code: `text`
		if (text[i] === '`') {
			if (current) {
				parts.push({ type: 'text', text: current });
				current = '';
			}
			i++;
			let codeText = '';
			while (i < text.length && text[i] !== '`') {
				codeText += text[i];
				i++;
			}
			if (i < text.length) {
				parts.push({ type: 'text', text: codeText, marks: [{ type: 'code' }] });
				i++;
			}
			continue;
		}

		// Underline: <u>text</u>
		if (text.substring(i, i + 3) === '<u>') {
			if (current) {
				parts.push({ type: 'text', text: current });
				current = '';
			}
			i += 3;
			let underlineText = '';
			while (i < text.length && text.substring(i, i + 4) !== '</u>') {
				underlineText += text[i];
				i++;
			}
			if (i < text.length) {
				parts.push({ type: 'text', text: underlineText, marks: [{ type: 'underline' }] });
				i += 4;
			}
			continue;
		}

		current += text[i];
		i++;
	}

	if (current) {
		parts.push({ type: 'text', text: current });
	}

	return parts.length > 0 ? parts : [{ type: 'text', text: '' }];
}

// Plain text extraction for display
function jsonToPlainText(jsonStr: string): string {
	try {
		const doc = JSON.parse(jsonStr);
		return extractText(doc);
	} catch {
		return '';
	}
}

function extractText(node: unknown): string {
	if (!node || typeof node !== 'object') return '';

	const n = node as Record<string, unknown>;

	// Hard break (line break within paragraph)
	if (n.type === 'hardBreak') {
		return '\n';
	}

	if (n.type === 'text' && typeof n.text === 'string') {
		return n.text;
	}

	// Embed nodes count as single line in sidebar
	if (n.type === 'embed') {
		return '[embedded section]';
	}

	if (Array.isArray(n.content)) {
		// For document root, join paragraphs with newlines
		if (n.type === 'doc') {
			return n.content.map(child => {
				const childNode = child as Record<string, unknown>;
				if (childNode.type === 'paragraph') {
					// Extract paragraph content
					if (Array.isArray(childNode.content)) {
						return childNode.content.map(extractText).join('');
					}
					return '';
				}
				// For non-paragraph blocks (headings, lists, etc), extract text recursively
				return extractText(child);
			}).join('\n');
		}

		// For other nodes (list items, blockquotes, etc), just join content
		return n.content.map(extractText).join('');
	}

	return '';
}

export default function DocumentEditor({
	document,
	isEditing,
	onSaved,
	citedLineRanges = [],
	onOpenCitations,
}: DocumentEditorProps) {
	const colors = useThemeColors();
	const theme = useTheme();
	const primaryContrastText = theme.palette.getContrastText(theme.palette.primary.main);
	const queryClient = useQueryClient();

	// Editor mode state
	const [mode, setMode] = useState<EditorMode>('wysiwyg');

	// Local state for editing
	const [title, setTitle] = useState(document.title);
	const [markdownContent, setMarkdownContent] = useState(() => jsonToPlainText(document.contentJson));
	const [sidebarMarkdown, setSidebarMarkdown] = useState(() => jsonToMarkdown(document.contentJson));
	const [hasChanges, setHasChanges] = useState(false);
	const markdownInputRef = useRef<HTMLTextAreaElement | null>(null);
	const embedIdByUrlRef = useRef<Record<string, string>>({});
	const isApplyingEditorContentRef = useRef(false);
	
	// Refs for content containers (used by LineNumberSidebar for position measurement)
	// Note: Markdown mode doesn't use contentRef - it falls back to fixed spacing
	const viewContentRef = useRef<HTMLDivElement>(null);
	const editorContentRef = useRef<HTMLDivElement>(null);

	const createEmbedFromCitation = useCallback(async (params: {
		citationText: string;
		sourceLineStart: number;
		sourceLineEnd: number;
	}): Promise<SectionEmbed | null> => {
		const parsed = parseCitationLink(params.citationText);
		if (!parsed) return null;

		try {
			const { targetIdentifier, targetLineStart, targetLineEnd } = parsed;

			const tryResolveTarget = async () => {
				if (isUUID(targetIdentifier)) {
					try {
						return await getDocument({ id: targetIdentifier, includeContent: false });
					} catch {
						return await getDocument({ slug: targetIdentifier, includeContent: false });
					}
				}
				try {
					return await getDocument({ slug: targetIdentifier, includeContent: false });
				} catch {
					return await getDocument({ id: targetIdentifier, includeContent: false });
				}
			};

			const targetDoc = await tryResolveTarget();

			const embedParams: CreateEmbedParams = {
				sourceDocumentId: document.id,
				sourceLineStart: params.sourceLineStart,
				sourceLineEnd: params.sourceLineEnd,
				targetDocumentId: targetDoc.document.id,
				targetLineStart,
				targetLineEnd,
				targetVersionNumber: parsed.targetVersion,
			};
			const embedResponse = await createEmbed(embedParams);
			return embedResponse.embed;
		} catch (error) {
			console.error('Failed to create embed:', error);
			return null;
		}
	}, [document.id]);

	const handlePasteMarkdown = useCallback(async (e: React.ClipboardEvent) => {
		const text = e.clipboardData?.getData('text/plain');
		if (!text) return;

		const parsed = parseCitationLink(text);
		if (!parsed) return;

		// Intercept paste and replace with URL-based embed token
		e.preventDefault();

		const textarea = markdownInputRef.current;
		const selectionStart = textarea?.selectionStart ?? markdownContent.length;
		const selectionEnd = textarea?.selectionEnd ?? markdownContent.length;

		const before = markdownContent.slice(0, selectionStart);
		const after = markdownContent.slice(selectionEnd);

		// Use URL-based token format directly (no need to create embed record)
		const token = `{{embed:${parsed.citationUrl}}}`;
		const nextValue = before + token + after;
		setMarkdownContent(nextValue);
		setHasChanges(true);

		// Restore cursor after token
		requestAnimationFrame(() => {
			if (!markdownInputRef.current) return;
			const nextPos = before.length + token.length;
			markdownInputRef.current.selectionStart = nextPos;
			markdownInputRef.current.selectionEnd = nextPos;
		});
	}, [markdownContent]);

	// Initialize TipTap editor
	const editor = useEditor({
		// TipTap may internally call flushSync; avoid React warnings by not forcing
		// React re-renders on every ProseMirror transaction.
		shouldRerenderOnTransaction: false,
		extensions: [
			StarterKit.configure({
				heading: {
					levels: [1, 2, 3],
				},
			}),
			Underline,
			Link.configure({
				openOnClick: false,
			}),
			EmbedNode,
		],
		editorProps: {
			handlePaste: (view, event) => {
				const text = event.clipboardData?.getData('text/plain');
				if (!text) return false;

				// Handle canonical resource links — insert as a hyperlink
				if (isCanonicalResourceLink(text)) {
					event.preventDefault();
					if (editor) {
						const { from, to } = view.state.selection;
						const selectedText = view.state.doc.textBetween(from, to);
						const linkText = selectedText || text;
						editor.chain().focus()
							.insertContent(`<a href="${text}">${linkText}</a>`)
							.run();
						queueMicrotask(() => setHasChanges(true));
					}
					return true;
				}

				const parsed = parseCitationLink(text);
				if (parsed) {
					event.preventDefault();

					// Compute source line from ProseMirror doc positions (NOT string indexes)
					const { from } = view.state.selection;
					const textBeforeCursor = view.state.doc.textBetween(0, from, '\n');
					const sourceLineStart = textBeforeCursor.split('\n').length;

					// Immediately insert a pending embed node with the URL
					// Embed record will be created on save
					if (editor) {
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						(editor.commands as any).setEmbed({
							citationUrl: parsed.citationUrl,
							sourceDocumentId: document.id,
							sourceLineStart,
							sourceLineEnd: sourceLineStart,
							targetLineStart: parsed.targetLineStart,
							targetLineEnd: parsed.targetLineEnd,
					targetVersion: parsed.targetVersion,
							// No embedId - will be created on save
						});
						queueMicrotask(() => setHasChanges(true));
					}

					return true;
				}

				return false; // Let default paste behavior handle other content
			},
		},
		content: document.contentJson ? JSON.parse(document.contentJson) : { type: 'doc', content: [] },
		editable: isEditing && mode === 'wysiwyg',
		onUpdate: ({ editor }) => {
			if (isApplyingEditorContentRef.current) return;
			const nextMarkdown = jsonToMarkdown(JSON.stringify(editor.getJSON()));
			queueMicrotask(() => {
				setHasChanges(true);
				setSidebarMarkdown(nextMarkdown);
			});
		},
	});

	const applyEditorContent = useCallback(
		(nextContent: unknown) => {
			if (!editor) return;
			isApplyingEditorContentRef.current = true;
			try {
				// TipTap's setContent accepts JSONContent which is a flexible type
				editor.commands.setContent(nextContent as TipTapNode);
			} finally {
				isApplyingEditorContentRef.current = false;
			}
		},
		[editor]
	);

	const snapshotEmbedIdByUrlFromEditor = useCallback(() => {
		if (!editor) return;
		const map: Record<string, string> = {};
		const walk = (node: TipTapNode | unknown) => {
			if (!node || typeof node !== 'object') return;
			const n = node as TipTapNode;
			if (n.type === 'embed') {
				const attrs = n.attrs as {
					embedId?: string;
					citationUrl?: string;
					targetDocumentId?: string;
					targetLineStart?: number;
					targetLineEnd?: number;
					targetVersion?: number;
				} | undefined;
				if (attrs?.embedId) {
					const url = buildEmbedUrlFromAttrs(attrs);
					if (url) map[url] = attrs.embedId;
					if (attrs.citationUrl) map[attrs.citationUrl] = attrs.embedId;
				}
			}
			if (Array.isArray(n.content)) {
				n.content.forEach(walk);
			}
		};
		walk(editor.getJSON());
		embedIdByUrlRef.current = map;
	}, [editor]);

	const markdownPreviewForSidebar = useMemo(() => {
		// For the line number sidebar, show embed tokens as a single placeholder line.
		return markdownContent.replaceAll(new RegExp(EMBED_MARKDOWN_TOKEN_RE.source, 'ig'), '[embedded section]');
	}, [markdownContent]);
	const canonicalLinks = useMemo(() => extractCanonicalResourceLinks(sidebarMarkdown), [sidebarMarkdown]);

	// Reset when document changes
	useEffect(() => {
		setTitle(document.title);
		const markdown = jsonToMarkdown(document.contentJson);
		setMarkdownContent(markdown);
		setSidebarMarkdown(markdown);

		if (editor && document.contentJson) {
			// Defer to avoid flushSync error - TipTap's setContent uses flushSync internally
			queueMicrotask(() => {
				try {
					const content = JSON.parse(document.contentJson);
					applyEditorContent(content);
				} catch {
					// Invalid JSON, set empty content
					applyEditorContent({ type: 'doc', content: [] });
				}
			});
		}
		setHasChanges(false);
	}, [document.id, document.title, document.contentJson, editor, applyEditorContent]);

	// Track changes for markdown mode
	useEffect(() => {
		if (mode === 'markdown') {
			const originalTitle = document.title;
			const originalContent = jsonToMarkdown(document.contentJson);
			setHasChanges(title !== originalTitle || markdownContent !== originalContent);
		}
	}, [title, markdownContent, document.title, document.contentJson, mode]);

	// Sync editor editable state
	useEffect(() => {
		if (editor) {
			editor.setEditable(isEditing && mode === 'wysiwyg');
		}
	}, [editor, isEditing, mode]);

	// When entering WYSIWYG edit mode, re-apply canonical contentJson so embeds render immediately.
	// Note: We always re-apply content when entering edit mode to ensure embed nodes render correctly.
	// This is necessary because TipTap's custom nodes may not re-render properly when `editable` changes.
	useEffect(() => {
		if (!editor) return;
		if (!isEditing) return;
		if (mode !== 'wysiwyg') return;
		if (!document.contentJson) return;

		// Defer to avoid flushSync error - TipTap's setContent uses flushSync internally
		// Use setTimeout to ensure EditorContent has remounted and attached to DOM
		setTimeout(() => {
			try {
				applyEditorContent(JSON.parse(document.contentJson));
			} catch {
				// ignore
			}
		}, 0);
	}, [editor, isEditing, mode, document.contentJson, applyEditorContent]);

	// When exiting edit mode, reset editor and local state back to canonical saved content.
	// This prevents view mode from rendering stale in-memory editor state after mode switches.
	useEffect(() => {
		if (!editor) return;
		if (isEditing) return;
		if (!document.contentJson) return;

		setMode('wysiwyg');
		setTitle(document.title);
		const markdown = jsonToMarkdown(document.contentJson);
		setMarkdownContent(markdown);
		setSidebarMarkdown(markdown);
		setHasChanges(false);

		// Defer to avoid flushSync error - TipTap's setContent uses flushSync internally
		// Use setTimeout to ensure EditorContent has remounted and attached to DOM
		setTimeout(() => {
			try {
				applyEditorContent(JSON.parse(document.contentJson));
			} catch {
				// ignore
			}
		}, 0);
	}, [editor, isEditing, document.id, document.title, document.contentJson, applyEditorContent]);

	// Save mutation
	const saveMutation = useMutation({
		mutationFn: async () => {
			let docContent: TipTapNode;
			
			if (mode === 'wysiwyg' && editor) {
				docContent = editor.getJSON() as TipTapNode;
			} else {
				docContent = JSON.parse(markdownToJson(markdownContent, { embedIdByUrl: embedIdByUrlRef.current })) as TipTapNode;
			}

			// Process embed nodes: create embed records for pending embeds (those with citationUrl but no embedId)
			const processNode = async (node: TipTapNode): Promise<TipTapNode> => {
				if (node.type === 'embed' && node.attrs?.citationUrl && !node.attrs?.embedId) {
					// This is a pending embed - create the embed record
					const citationUrl = String(node.attrs.citationUrl);
					const parsed = parseCitationLink(citationUrl);
					if (parsed) {
						try {
							const embed = await createEmbedFromCitation({
								citationText: citationUrl,
								sourceLineStart: (node.attrs.sourceLineStart as number | undefined) || 1,
								sourceLineEnd: (node.attrs.sourceLineEnd as number | undefined) || 1,
							});
							
							if (embed) {
								// Update node with embedId and target info
								return {
									...node,
									attrs: {
										...node.attrs,
										embedId: embed.id,
										targetDocumentId: embed.targetDocumentId,
									},
								};
							}
						} catch (error) {
							console.error('Failed to create embed during save:', error);
						}
					}
				}
				
				// Recursively process content array
				if (node.content && Array.isArray(node.content)) {
					return {
						...node,
						content: await Promise.all(node.content.map(processNode)),
					};
				}
				
				return node;
			};

			// Process all nodes to create pending embeds
			const processedContent = await processNode(docContent);
			const contentJson = JSON.stringify(processedContent);

			// Keep local WYSIWYG state in sync so embeds stop showing pending after save.
			if (mode === 'wysiwyg' && editor) {
				try {
					applyEditorContent(processedContent);
				} catch {
					// ignore
				}
			}

			return updateDocument({
				id: document.id,
				title: title.trim() || undefined,
				contentJson,
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['docs'] });
			setHasChanges(false);
			onSaved();
		},
	});

	const handleSave = useCallback(() => {
		if (!hasChanges) return;
		saveMutation.mutate();
	}, [hasChanges, saveMutation]);

	// Keyboard shortcut for save
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 's' && isEditing) {
				e.preventDefault();
				handleSave();
			}
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [handleSave, isEditing]);

	// Mode toggle handler
	const handleModeChange = (newMode: EditorMode) => {
		if (!newMode || newMode === mode) return;

		// Sync content between modes
		if (newMode === 'markdown' && editor) {
			snapshotEmbedIdByUrlFromEditor();
			const markdown = jsonToMarkdown(JSON.stringify(editor.getJSON()));
			setMarkdownContent(markdown);
		} else if (newMode === 'wysiwyg') {
			const contentJson = markdownToJson(markdownContent, { embedIdByUrl: embedIdByUrlRef.current });
			if (editor) {
				try {
					applyEditorContent(JSON.parse(contentJson));
				} catch {
					// Invalid JSON
				}
			}
		}

		setMode(newMode);
	};

	if (!isEditing) {
		// Read-only view
		if (!editor) return null;

		return (
			<Box>
				<Typography variant="h4" gutterBottom fontWeight={600}>
					{document.title}
				</Typography>

				{/* View Mode with Line Numbers */}
				<Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
					{/* Line Number Sidebar */}
					<LineNumberSidebar
						content={sidebarMarkdown}
						documentSlug={document.slug}
						documentVersion={document.versionCount}
						mode="view"
						contentRef={viewContentRef}
						citedLineRanges={citedLineRanges}
						onCitedLineClick={() => onOpenCitations?.()}
					/>

					{/* Document Content */}
					<Box
						ref={viewContentRef}
						sx={{
							flex: 1,
							'& .ProseMirror': {
								outline: 'none',
								lineHeight: 1.8,
								...colors.text.primary.style,
							},
							'& .ProseMirror p': {
								margin: 0,
								lineHeight: 1.8,
							},
							'& .ProseMirror h1': {
								fontSize: '2em',
								fontWeight: 600,
								margin: '0.67em 0',
							},
							'& .ProseMirror h2': {
								fontSize: '1.5em',
								fontWeight: 600,
								margin: '0.75em 0',
							},
							'& .ProseMirror h3': {
								fontSize: '1.17em',
								fontWeight: 600,
								margin: '0.83em 0',
							},
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
						<CanonicalLinkPreviewList urls={canonicalLinks} />
					</Box>
				</Box>
			</Box>
		);
	}

	// Edit mode
	if (!editor) return null;

	return (
		<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
			{saveMutation.error && (
				<Alert severity="error">
					{saveMutation.error instanceof Error
						? saveMutation.error.message
						: 'Failed to save'}
				</Alert>
			)}

			<TextField
				fullWidth
				variant="standard"
				value={title}
				onChange={(e) => setTitle(e.target.value)}
				placeholder="Document title"
				InputProps={{
					sx: {
						fontSize: '2rem',
						fontWeight: 600,
					},
				}}
				data-testid="doc-title-input"
			/>

			{/* Mode Toggle */}
			<Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
				<ToggleButtonGroup
					value={mode}
					exclusive
					onChange={(_, v) => handleModeChange(v)}
					size="small"
					data-testid="editor-mode-toggle"
				>
					<ToggleButton value="wysiwyg" data-testid="mode-wysiwyg">
						WYSIWYG
					</ToggleButton>
					<ToggleButton value="markdown" data-testid="mode-markdown">
						Markdown
					</ToggleButton>
				</ToggleButtonGroup>
			</Box>

			{/* WYSIWYG Mode */}
			{mode === 'wysiwyg' && (
				<>
					{/* Formatting Toolbar */}
					<Paper
						sx={{
							p: 1,
							display: 'flex',
							gap: 0.5,
							flexWrap: 'wrap',
							...colors.bg.paper.style,
						}}
						data-testid="formatting-toolbar"
					>
						{/* Text Formatting */}
						<Tooltip title="Bold (Ctrl+B)">
							<IconButton
								size="small"
								onClick={() => editor.chain().focus().toggleBold().run()}
								disabled={!editor.can().chain().focus().toggleBold().run()}
								data-active={editor.isActive('bold') ? 'true' : undefined}
								sx={{
									'&[data-active="true"]': {
										...colors.primary.main.style,
											color: primaryContrastText,
									},
								}}
								data-testid="format-bold"
							>
								<BoldIcon fontSize="small" />
							</IconButton>
						</Tooltip>

						<Tooltip title="Italic (Ctrl+I)">
							<IconButton
								size="small"
								onClick={() => editor.chain().focus().toggleItalic().run()}
								disabled={!editor.can().chain().focus().toggleItalic().run()}
								data-active={editor.isActive('italic') ? 'true' : undefined}
								sx={{
									'&[data-active="true"]': {
										...colors.primary.main.style,
											color: primaryContrastText,
									},
								}}
								data-testid="format-italic"
							>
								<ItalicIcon fontSize="small" />
							</IconButton>
						</Tooltip>

						<Tooltip title="Underline (Ctrl+U)">
							<IconButton
								size="small"
								onClick={() => editor.chain().focus().toggleUnderline().run()}
								disabled={!editor.can().chain().focus().toggleUnderline().run()}
								data-active={editor.isActive('underline') ? 'true' : undefined}
								sx={{
									'&[data-active="true"]': {
										...colors.primary.main.style,
											color: primaryContrastText,
									},
								}}
								data-testid="format-underline"
							>
								<UnderlineIcon fontSize="small" />
							</IconButton>
						</Tooltip>

						<Tooltip title="Inline Code">
							<IconButton
								size="small"
								onClick={() => editor.chain().focus().toggleCode().run()}
								disabled={!editor.can().chain().focus().toggleCode().run()}
								data-active={editor.isActive('code') ? 'true' : undefined}
								sx={{
									'&[data-active="true"]': {
										...colors.primary.main.style,
											color: primaryContrastText,
									},
								}}
								data-testid="format-code"
							>
								<CodeIcon fontSize="small" />
							</IconButton>
						</Tooltip>

						<Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

						{/* Headings */}
						<Tooltip title="Heading 1">
							<IconButton
								size="small"
								onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
								data-active={editor.isActive('heading', { level: 1 }) ? 'true' : undefined}
								sx={{
									'&[data-active="true"]': {
										...colors.primary.main.style,
											color: primaryContrastText,
									},
								}}
								data-testid="format-h1"
							>
								<Typography fontSize="small" fontWeight="bold">H1</Typography>
							</IconButton>
						</Tooltip>

						<Tooltip title="Heading 2">
							<IconButton
								size="small"
								onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
								data-active={editor.isActive('heading', { level: 2 }) ? 'true' : undefined}
								sx={{
									'&[data-active="true"]': {
										...colors.primary.main.style,
											color: primaryContrastText,
									},
								}}
								data-testid="format-h2"
							>
								<Typography fontSize="small" fontWeight="bold">H2</Typography>
							</IconButton>
						</Tooltip>

						<Tooltip title="Heading 3">
							<IconButton
								size="small"
								onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
								data-active={editor.isActive('heading', { level: 3 }) ? 'true' : undefined}
								sx={{
									'&[data-active="true"]': {
										...colors.primary.main.style,
											color: primaryContrastText,
									},
								}}
								data-testid="format-h3"
							>
								<Typography fontSize="small" fontWeight="bold">H3</Typography>
							</IconButton>
						</Tooltip>

						<Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

						{/* Lists */}
						<Tooltip title="Bullet List">
							<IconButton
								size="small"
								onClick={() => editor.chain().focus().toggleBulletList().run()}
								data-active={editor.isActive('bulletList') ? 'true' : undefined}
								sx={{
									'&[data-active="true"]': {
										...colors.primary.main.style,
											color: primaryContrastText,
									},
								}}
								data-testid="format-bullet-list"
							>
								<BulletListIcon fontSize="small" />
							</IconButton>
						</Tooltip>

						<Tooltip title="Numbered List">
							<IconButton
								size="small"
								onClick={() => editor.chain().focus().toggleOrderedList().run()}
								data-active={editor.isActive('orderedList') ? 'true' : undefined}
								sx={{
									'&[data-active="true"]': {
										...colors.primary.main.style,
											color: primaryContrastText,
									},
								}}
								data-testid="format-numbered-list"
							>
								<NumberedListIcon fontSize="small" />
							</IconButton>
						</Tooltip>

						<Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

						{/* Blocks */}
						<Tooltip title="Blockquote">
							<IconButton
								size="small"
								onClick={() => editor.chain().focus().toggleBlockquote().run()}
								data-active={editor.isActive('blockquote') ? 'true' : undefined}
								sx={{
									'&[data-active="true"]': {
										...colors.primary.main.style,
											color: primaryContrastText,
									},
								}}
								data-testid="format-blockquote"
							>
								<BlockquoteIcon fontSize="small" />
							</IconButton>
						</Tooltip>

						<Tooltip title="Code Block">
							<IconButton
								size="small"
								onClick={() => editor.chain().focus().toggleCodeBlock().run()}
								data-active={editor.isActive('codeBlock') ? 'true' : undefined}
								sx={{
									'&[data-active="true"]': {
										...colors.primary.main.style,
											color: primaryContrastText,
									},
								}}
								data-testid="format-code-block"
							>
								<CodeBlockIcon fontSize="small" />
							</IconButton>
						</Tooltip>

					</Paper>

					{/* Editor with Line Numbers */}
					<Box sx={{ display: 'flex', gap: 1 }}>
						{/* Line Number Sidebar */}
						<LineNumberSidebar
								content={sidebarMarkdown}
							documentSlug={document.slug}
							documentVersion={document.versionCount}
							mode="view"
							contentRef={editorContentRef}
						/>

						{/* TipTap Editor */}
						<Box
							ref={editorContentRef}
							sx={{
								flex: 1,
								'& .ProseMirror': {
									outline: 'none',
									minHeight: '400px',
									padding: 2,
									border: 1,
									borderRadius: 1,
									lineHeight: 1.8,
									...colors.border.default.style,
									...colors.text.primary.style,
								},
								'& .ProseMirror:focus': {
									borderColor: theme.palette.primary.main,
								},
								'& .ProseMirror p': {
									margin: 0,
									lineHeight: 1.8,
								},
								'& .ProseMirror h1': {
									fontSize: '2em',
									fontWeight: 600,
									margin: '0.67em 0',
								},
								'& .ProseMirror h2': {
									fontSize: '1.5em',
									fontWeight: 600,
									margin: '0.75em 0',
								},
								'& .ProseMirror h3': {
									fontSize: '1.17em',
									fontWeight: 600,
									margin: '0.83em 0',
								},
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
							data-testid="doc-content-editor"
						>
							<EditorContent editor={editor} />
						</Box>
					</Box>
				</>
			)}

			{/* Markdown Mode */}
			{mode === 'markdown' && (
				<Box sx={{ display: 'flex', gap: 1 }}>
					{/* Line Number Sidebar - markdown mode uses simple fixed spacing */}
					<LineNumberSidebar
							content={markdownPreviewForSidebar}
						documentSlug={document.slug}
						documentVersion={document.versionCount}
						mode="markdown"
					/>

					{/* Markdown Editor */}
					<TextField
						fullWidth
						multiline
						minRows={10}
						value={markdownContent}
						onChange={(e) => setMarkdownContent(e.target.value)}
							onPaste={handlePasteMarkdown}
						placeholder="Start writing in markdown..."
						variant="outlined"
							inputRef={(el) => {
								markdownInputRef.current = el as HTMLTextAreaElement | null;
							}}
						sx={{
							'& .MuiInputBase-root': {
								fontFamily: 'monospace',
								fontSize: '1rem',
								lineHeight: 1.8,
							},
						}}
						data-testid="doc-content-markdown"
					/>
				</Box>
			)}

			<Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
				<Button
					variant="contained"
					onClick={handleSave}
					disabled={!hasChanges || saveMutation.isPending}
					data-testid="doc-save-btn"
				>
					{saveMutation.isPending ? (
						<CircularProgress size={20} />
					) : (
						'Save (⌘S)'
					)}
				</Button>
			</Box>
		</Box>
	);
}
