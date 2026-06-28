/**
 * Message Composer Component
 * WYSIWYG editor for composing messages with @mentions
 * 
 * Features:
 * - TipTap editor with Markdown support
 * - Rich text formatting toolbar (Bold, Italic, Underline, Lists, Code, Links)
 * - Toggleable formatting toolbar to save vertical space
 * - Emoji picker with common emojis
 * - @mention autocomplete
 * - Auto-resizing editor (up to 50% viewport height)
 * - Keyboard shortcuts: Enter or Cmd+Enter to send, Shift+Enter for newline
 * - Compact mode for replies (no toolbar)
 */

'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Mention from '@tiptap/extension-mention';
import { Alert, Box, IconButton, Tooltip, Typography, Dialog, DialogTitle, DialogContent, DialogActions, Button } from '@mui/material';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlined';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import CodeIcon from '@mui/icons-material/Code';
import LinkIcon from '@mui/icons-material/Link';
import EmojiEmotionsIcon from '@mui/icons-material/EmojiEmotions';
import ReactionPicker from './ReactionPicker';
import EditIcon from '@mui/icons-material/Edit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { startTyping, stopTyping, autocompleteEmployees, autocompleteDepartments } from 'apis';
import MentionList, { MentionItem } from './MentionList';
import tippy, { Instance as TippyInstance } from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import { useThemeColors } from '@/theme/useThemeColors';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CallIcon from '@mui/icons-material/Call';
import Close from '@mui/icons-material/Close';
import ChatFileUpload from './ChatFileUpload';
import type { ChatFileMetadata } from 'apis';
import type { UseVoiceCallResult } from '../hooks/useVoiceCall';
import VoiceMessageRecorder from './voice/VoiceMessageRecorder';

// Utility function to format bytes for display
function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 Bytes';
	const k = 1024;
	const sizes = ['Bytes', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

import './editor.css';

interface MessageComposerProps {
	channelId?: string; // Optional for reply mode
	parentMessageId?: string; // Optional for thread typing indicators
	onSend: (messageText: string, fileIds?: string[]) => Promise<void>;
	disabled?: boolean;
	placeholder?: string;
	compact?: boolean; // Compact mode for replies (no toolbar, smaller)
	autoFocus?: boolean;
	voiceCall?: UseVoiceCallResult;
	onVoiceMessageSent?: () => void;
}

export default function MessageComposer({
	channelId,
	parentMessageId,
	onSend,
	disabled = false,
	placeholder = 'Type a message...',
	compact = false,
	autoFocus = false,
	voiceCall,
	onVoiceMessageSent,
}: MessageComposerProps) {
	const [isSending, setIsSending] = useState(false);
	const [showToolbar, setShowToolbar] = useState(false);
	const [reactionPickerAnchor, setReactionPickerAnchor] = useState<HTMLButtonElement | null>(null);
	const [showFileUpload, setShowFileUpload] = useState(false);
	const [uploadedFiles, setUploadedFiles] = useState<ChatFileMetadata[]>([]);
	// Initial height: 60px for compact mode (thread replies), 44px for full mode
	const [editorHeight, setEditorHeight] = useState<number>(compact ? 60 : 44);
	const editorContainerRef = useRef<HTMLDivElement>(null);
	const colors = useThemeColors();

	// Create lowlight instance for syntax highlighting
	const lowlight = createLowlight(common);

	// Initialize TipTap editor
	const editor = useEditor({
		extensions: [
			StarterKit.configure({
				paragraph: {
					HTMLAttributes: {
						class: 'text-sm',
					},
				},
				codeBlock: false, // Disable default code block to use lowlight version
			}),
			CodeBlockLowlight.configure({
				lowlight,
				HTMLAttributes: {
					class: 'code-block-editor',
				},
			}),
			Underline,
			Link.configure({
				openOnClick: false,
				HTMLAttributes: {
					class: 'mention-link underline cursor-pointer',
					style: 'color: var(--mui-palette-primary-main)',
				},
			}),
			Mention.configure({
				HTMLAttributes: {
					class: 'mention-tag font-medium px-1 rounded',
					style: 'color: var(--mui-palette-primary-main); background-color: var(--mui-palette-primary-light); opacity: 0.9',
				},
				suggestion: {
					items: async ({ query }: { query: string }) => {
						if (!query.trim()) return [];

						const items: MentionItem[] = [];

						try {
							const employees = await autocompleteEmployees(query, 10);
							items.push(
								...employees.map((e) => ({
									id: e.id || '',
									type: 'employee' as const,
									label: [e.givenName, e.familyName].filter(Boolean).join(' '),
									subtitle: e.email || '',
								}))
							);
						} catch (error) {
							console.error('Failed to autocomplete employees:', error);
						}

						try {
							const departments = await autocompleteDepartments(query, 5);
							items.push(
								...departments.map((d) => ({
									id: d.id || '',
									type: 'department' as const,
									label: d.name || '',
									subtitle: 'Department',
								}))
							);
						} catch (error) {
							console.error('Failed to fetch departments:', error);
						}

						return items;
					},
					render: () => {
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						let reactRenderer: any = null;
						let popup: TippyInstance[];

						return {
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							onStart: (props: any) => {
								const container = document.createElement('div');
								const root = createRoot(container);

								reactRenderer = {
									element: container,
									root,
									component: null,
									ref: React.createRef(),
								};

								root.render(
									<MentionList
										ref={reactRenderer.ref}
										items={props.items}
										command={props.command}
									/>
								);

								if (!props.clientRect) {
									return;
								}

								popup = tippy('body', {
									getReferenceClientRect: props.clientRect,
									appendTo: () => document.body,
									content: container,
									showOnCreate: true,
									interactive: true,
									trigger: 'manual',
									placement: 'bottom-start',
								});
							},

							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							onUpdate(props: any) {
								if (reactRenderer && reactRenderer.root) {
									reactRenderer.root.render(
										<MentionList
											ref={reactRenderer.ref}
											items={props.items}
											command={props.command}
										/>
									);
								}

								if (!props.clientRect) {
									return;
								}

								if (popup && popup[0]) {
									popup[0].setProps({
										getReferenceClientRect: props.clientRect,
									});
								}
							},

							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							onKeyDown(props: any) {
								if (props.event.key === 'Escape') {
									if (popup && popup[0]) {
										popup[0].hide();
									}
									return true;
								}

								return reactRenderer?.ref?.current?.onKeyDown?.(props.event) || false;
							},

							onExit() {
								if (popup && popup[0]) {
									popup[0].destroy();
								}
								if (reactRenderer && reactRenderer.root) {
									reactRenderer.root.unmount();
								}
							},
						};
					},
				},
			}),
		],
		content: '',
		editorProps: {
			attributes: {
				class: `prose prose-sm max-w-none focus:outline-none px-3 py-2`,
				placeholder: placeholder,
			},
		},
		onUpdate: () => {
			// Auto-adjust height based on content
			updateEditorHeight();
		},
		autofocus: autoFocus,
	});

	// Typing indicator logic
	const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const isTypingRef = useRef<boolean>(false);

	useEffect(() => {
		if (!editor || !channelId) return;

		const handleUpdate = () => {
			// Only send typing indicator if editor has content
			const html = editor.getHTML().trim();
			const hasContent = html && html !== '<p></p>';

			if (hasContent) {
				// Send start typing if not already typing
				if (!isTypingRef.current) {
					console.log('[MessageComposer] Sending startTyping:', { channelId, parentMessageId });
					startTyping(channelId, parentMessageId).catch(err => {
						console.error('[MessageComposer] Failed to send startTyping:', err);
					});
					isTypingRef.current = true;
				}

				// Clear existing timeout
				if (typingTimeoutRef.current) {
					clearTimeout(typingTimeoutRef.current);
				}

				// Set timeout to send stop typing after 3 seconds of inactivity
				typingTimeoutRef.current = setTimeout(() => {
					if (isTypingRef.current) {
						stopTyping(channelId, parentMessageId).catch(err => {
							console.error('[MessageComposer] Failed to send stopTyping:', err);
						});
						isTypingRef.current = false;
					}
				}, 3000);
			}
		};

		// Listen to editor updates
		editor.on('update', handleUpdate);

		// Cleanup on unmount or channelId change
		return () => {
			editor.off('update', handleUpdate);

			// Clear timeout
			if (typingTimeoutRef.current) {
				clearTimeout(typingTimeoutRef.current);
			}

			// Send stop typing if we were typing
			if (isTypingRef.current && channelId) {
				stopTyping(channelId, parentMessageId).catch(err => {
					console.error('[MessageComposer] Failed to send stopTyping on cleanup:', err);
				});
				isTypingRef.current = false;
			}
		};
	}, [editor, channelId, parentMessageId]);

	// Update editor height based on content, with max at 50% viewport height
	const updateEditorHeight = () => {
		if (!editor || !editorContainerRef.current) return;

		// Find the ProseMirror element within THIS editor's container
		const editorElement = editorContainerRef.current.querySelector('.ProseMirror') as HTMLElement;
		if (!editorElement) return;

		// Get the scroll height (actual content height)
		const contentHeight = editorElement.scrollHeight;

		// Calculate max height as 50% of viewport height
		const maxHeight = window.innerHeight * 0.5;

		// Set height between min (44px for full mode, 60px for compact) and max (50vh)
		const minHeight = compact ? 60 : 44;
		const newHeight = Math.min(Math.max(contentHeight, minHeight), maxHeight);

		setEditorHeight(newHeight);
	};

	// Check if editor has reached max height (needs scrollbar)
	const isAtMaxHeight = () => {
		if (!editor || !editorContainerRef.current) return false;

		const editorElement = editorContainerRef.current.querySelector('.ProseMirror') as HTMLElement;
		if (!editorElement) return false;

		const maxHeight = window.innerHeight * 0.5;
		return editorElement.scrollHeight > maxHeight;
	};

	const handleSend = async () => {
		if (!editor || disabled || isSending) return;

		// Get HTML content from TipTap editor (backend will sanitize)
		const html = editor.getHTML().trim();
		// Check if editor has actual text content (not just empty HTML tags)
		// TipTap can return various empty states: "<p></p>", "<p><br></p>", "<p> </p>", etc.
		const textContent = editor.getText().trim();
		// Don't send if no text content and no uploaded files (file-only messages are allowed)
		if (!textContent && uploadedFiles.length === 0) return;

		setIsSending(true);
		try {
			// Send stop typing before sending message (user finished typing)
			if (isTypingRef.current && channelId) {
				// Clear timeout to prevent duplicate stopTyping
				if (typingTimeoutRef.current) {
					clearTimeout(typingTimeoutRef.current);
					typingTimeoutRef.current = null;
				}

				await stopTyping(channelId, parentMessageId).catch(err => {
					console.error('[MessageComposer] Failed to send stopTyping on send:', err);
				});
				isTypingRef.current = false;
			}

			// Collect file IDs from uploaded files
			const fileIds = uploadedFiles.length > 0 ? uploadedFiles.map(f => f.id) : undefined;

			await onSend(html, fileIds);
			editor.commands.clearContent();
			// Clear uploaded files after sending
			setUploadedFiles([]);
			// Reset height after sending
			setEditorHeight(compact ? 60 : 44);
		} catch (error) {
			console.error('Failed to send message:', error);
		} finally {
			setIsSending(false);
		}
	};

	// Handle keyboard shortcuts
	const handleKeyDown = (e: React.KeyboardEvent) => {
		// Cmd+Enter or Ctrl+Enter to send
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			handleSend();
			return;
		}

		// Plain Enter (without Shift) to send in both full and compact modes
		// Shift+Enter remains the newline behavior.
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
			return;
		}
	};

	const handleReactionPickerOpen = (event: React.MouseEvent<HTMLButtonElement>) => {
		setReactionPickerAnchor(event.currentTarget);
	};

	const handleReactionSelect = (emoji: string) => {
		if (editor) {
			editor.chain().focus().insertContent(emoji).run();
		}
		setReactionPickerAnchor(null);
	};

	// Handle file upload completion
	const handleFileUploadComplete = (file: ChatFileMetadata) => {
		console.log('[MessageComposer] File uploaded:', file);
		setUploadedFiles(prev => [...prev, file]);
	};

	// Handle file removal
	const handleRemoveFile = (fileId: string) => {
		setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
	};

	const handleFileUploadError = (error: Error) => {
		console.error('[MessageComposer] File upload failed:', error);
		// Error is already shown by FileUploadWidget
	};

	// Formatting handlers
	const toggleBold = () => {
		if (editor) editor.chain().focus().toggleBold().run();
	};

	const toggleItalic = () => {
		if (editor) editor.chain().focus().toggleItalic().run();
	};

	const toggleUnderline = () => {
		if (editor) editor.chain().focus().toggleUnderline().run();
	};

	const toggleBulletList = () => {
		if (editor) editor.chain().focus().toggleBulletList().run();
	};

	const toggleOrderedList = () => {
		if (editor) editor.chain().focus().toggleOrderedList().run();
	};

	const toggleCodeBlock = () => {
		if (editor) editor.chain().focus().toggleCodeBlock().run();
	};

	const setLink = () => {
		if (!editor) return;

		const previousUrl = editor.getAttributes('link').href;
		const url = window.prompt('URL', previousUrl);

		// cancelled
		if (url === null) {
			return;
		}

		// empty
		if (url === '') {
			editor.chain().focus().extendMarkRange('link').unsetLink().run();
			return;
		}

		// update link
		editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
	};

	// Compact mode: simple textarea-like experience for replies
	if (compact) {
		const needsScroll = isAtMaxHeight();
		return (
			<div className="w-full" ref={editorContainerRef}>
				<div
					className={`${colors.border.default.className} border rounded-lg transition-all ${needsScroll ? 'overflow-y-auto' : 'overflow-y-hidden'} ${disabled ? 'opacity-50' : ''} ${colors.bg.default.className}`}
					style={{ height: `${editorHeight}px` }}
				>
					<div className="h-full">
						<EditorContent editor={editor} className="h-full" onKeyDownCapture={handleKeyDown} />
					</div>
				</div>

				{/* Uploaded Files List - 4 Column Grid */}
				{uploadedFiles.length > 0 && (
					<div className="mt-2 grid grid-cols-4 gap-2">
						{uploadedFiles.map((file) => (
							<div
								key={file.id}
								className={`flex flex-col px-2 py-1.5 ${colors.bg.default.className} ${colors.border.default.className} border rounded-lg relative group`}
							>
								<IconButton
									size="small"
									onClick={() => handleRemoveFile(file.id)}
									data-testid={`remove-file-${file.id}`}
									className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity"
									sx={{
										backgroundColor: 'background.paper',
										'&:hover': { backgroundColor: 'action.hover' },
										width: 20,
										height: 20,
									}}
								>
									<Close fontSize="small" style={{ ...colors.text.secondary.style, fontSize: '14px' }} />
								</IconButton>
								<div className="flex items-center gap-1 min-w-0">
									<AttachFileIcon fontSize="small" style={{ ...colors.text.secondary.style, fontSize: '16px' }} />
									<span className="text-xs truncate" style={colors.text.primary.style} title={file.originalFilename}>
										{file.originalFilename}
									</span>
								</div>
								<span className="text-xs mt-0.5" style={colors.text.secondary.style}>
									{formatBytes(file.sizeBytes)}
								</span>
							</div>
						))}
					</div>
				)}

				<div className="flex justify-end mt-2">
					<button
						onClick={handleSend}
						disabled={disabled || isSending}
						className={`px-3 py-1.5 ${colors.primary.main.className} text-white text-sm font-medium rounded-lg ${colors.primary.hover} disabled:opacity-50 disabled:cursor-not-allowed`}
					>
						{isSending ? 'Sending...' : 'Send'}
					</button>
				</div>
			</div>
		);
	}

	// Full mode: rich editor with toolbar for channel messages
	const needsScroll = isAtMaxHeight();

	return (
		<div className={`${colors.border.default.className} border-t ${colors.bg.paper.className} p-3`} ref={editorContainerRef}>
			{voiceCall?.error && !voiceCall.call && (
				<Alert data-testid="voice-call-error" severity="error" sx={{ mb: 1 }}>
					{voiceCall.error.message}
				</Alert>
			)}
			<div
				className={`${colors.border.default.className} border rounded-lg transition-all ${needsScroll ? 'overflow-y-auto' : 'overflow-y-hidden'} ${disabled ? 'opacity-50' : ''} ${colors.bg.default.className}`}
				style={{ height: `${editorHeight}px` }}
			>
				<div className="h-full">
					<EditorContent editor={editor} className="h-full" onKeyDownCapture={handleKeyDown} />
				</div>
			</div>

			{/* Uploaded Files List - 4 Column Grid */}
			{uploadedFiles.length > 0 && (
				<div className="mt-2 grid grid-cols-4 gap-2">
					{uploadedFiles.map((file) => (
						<div
							key={file.id}
							className={`flex flex-col px-2 py-1.5 ${colors.bg.default.className} ${colors.border.default.className} border rounded-lg relative group`}
						>
							<IconButton
								size="small"
								onClick={() => handleRemoveFile(file.id)}
								data-testid={`remove-file-${file.id}`}
								className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity"
								sx={{
									backgroundColor: 'background.paper',
									'&:hover': { backgroundColor: 'action.hover' },
									width: 20,
									height: 20,
								}}
							>
								<Close fontSize="small" style={{ ...colors.text.secondary.style, fontSize: '14px' }} />
							</IconButton>
							<div className="flex items-center gap-1 min-w-0">
								<AttachFileIcon fontSize="small" style={{ ...colors.text.secondary.style, fontSize: '16px' }} />
								<span className="text-xs truncate" style={colors.text.primary.style} title={file.originalFilename}>
									{file.originalFilename}
								</span>
							</div>
							<span className="text-xs mt-0.5" style={colors.text.secondary.style}>
								{formatBytes(file.sizeBytes)}
							</span>
						</div>
					))}
				</div>
			)}

			{/* Toolbar */}
			<div className="flex items-start justify-between gap-2 mt-2">
				<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
					{/* Toggle toolbar button */}
					<Tooltip title={showToolbar ? "Hide formatting tools" : "Show formatting tools"}>
						<IconButton
							size="small"
							disabled={disabled}
							onClick={() => setShowToolbar(!showToolbar)}
							sx={{
								bgcolor: showToolbar ? 'action.selected' : 'transparent',
								'&:hover': {
									bgcolor: showToolbar ? 'action.hover' : 'action.hover',
								}
							}}
						>
							<EditIcon fontSize="small" />
						</IconButton>
					</Tooltip>

					{/* Formatting tools (shown when toolbar is visible) */}
					{showToolbar && (
						<>
							<Tooltip title="Bold (Cmd+B)">
								<IconButton
									size="small"
									disabled={disabled}
									onClick={toggleBold}
									sx={{
										bgcolor: editor?.isActive('bold') ? 'action.selected' : 'transparent',
									}}
								>
									<FormatBoldIcon fontSize="small" />
								</IconButton>
							</Tooltip>
							<Tooltip title="Italic (Cmd+I)">
								<IconButton
									size="small"
									disabled={disabled}
									onClick={toggleItalic}
									sx={{
										bgcolor: editor?.isActive('italic') ? 'action.selected' : 'transparent',
									}}
								>
									<FormatItalicIcon fontSize="small" />
								</IconButton>
							</Tooltip>
							<Tooltip title="Underline (Cmd+U)">
								<IconButton
									size="small"
									disabled={disabled}
									onClick={toggleUnderline}
									sx={{
										bgcolor: editor?.isActive('underline') ? 'action.selected' : 'transparent',
									}}
								>
									<FormatUnderlinedIcon fontSize="small" />
								</IconButton>
							</Tooltip>
							<Box sx={{ width: 1, height: 24, bgcolor: 'divider', mx: 0.5 }} />
							<Tooltip title="Bullet list">
								<IconButton
									size="small"
									disabled={disabled}
									onClick={toggleBulletList}
									sx={{
										bgcolor: editor?.isActive('bulletList') ? 'action.selected' : 'transparent',
									}}
								>
									<FormatListBulletedIcon fontSize="small" />
								</IconButton>
							</Tooltip>
							<Tooltip title="Numbered list">
								<IconButton
									size="small"
									disabled={disabled}
									onClick={toggleOrderedList}
									sx={{
										bgcolor: editor?.isActive('orderedList') ? 'action.selected' : 'transparent',
									}}
								>
									<FormatListNumberedIcon fontSize="small" />
								</IconButton>
							</Tooltip>
							<Tooltip title="Code block">
								<IconButton
									size="small"
									disabled={disabled}
									onClick={toggleCodeBlock}
									sx={{
										bgcolor: editor?.isActive('codeBlock') ? 'action.selected' : 'transparent',
									}}
								>
									<CodeIcon fontSize="small" />
								</IconButton>
							</Tooltip>
							<Tooltip title="Add link">
								<IconButton
									size="small"
									disabled={disabled}
									onClick={setLink}
									sx={{
										bgcolor: editor?.isActive('link') ? 'action.selected' : 'transparent',
									}}
								>
									<LinkIcon fontSize="small" />
								</IconButton>
							</Tooltip>
						</>
					)}

					{/* File attachment button - T055 */}
					<Tooltip title="Attach file">
						<IconButton
							size="small"
							disabled={disabled}
							onClick={() => setShowFileUpload(true)}
							data-testid="chat-file-upload"
						>
							<AttachFileIcon fontSize="small" />
						</IconButton>
					</Tooltip>

					{!compact && voiceCall?.canStart && (
						<Tooltip title="Start voice call">
							<IconButton
								size="small"
								disabled={disabled || voiceCall.isLoading}
								onClick={() => { void voiceCall.startCall(); }}
								data-testid="voice-start-call-button"
							>
								<CallIcon fontSize="small" />
							</IconButton>
						</Tooltip>
					)}

					{!compact && (
						<VoiceMessageRecorder channelId={channelId} disabled={disabled} onSent={onVoiceMessageSent} />
					)}

					{/* Emoji picker */}
					<Tooltip title="Quick reactions">
						<IconButton size="small" disabled={disabled} onClick={handleReactionPickerOpen}>
							<EmojiEmotionsIcon fontSize="small" />
						</IconButton>
					</Tooltip>
					<ReactionPicker
						open={Boolean(reactionPickerAnchor)}
						anchorEl={reactionPickerAnchor}
						onClose={() => setReactionPickerAnchor(null)}
						onSelect={handleReactionSelect}
					/>

				</div>

				<div className="flex items-center gap-2">
					<Typography variant="caption" color="text.secondary">
						Enter to send · Shift+Enter for newline
					</Typography>
					<button
						onClick={handleSend}
						disabled={disabled || isSending}
						className={`px-4 py-1.5 ${colors.primary.main.className} text-white text-sm font-medium rounded-lg ${colors.primary.hover} disabled:opacity-50 disabled:cursor-not-allowed`}
					>
						{isSending ? 'Sending...' : 'Send'}
					</button>
				</div>
			</div>

			{/* File Upload Dialog */}
			<Dialog
				open={showFileUpload}
				onClose={() => setShowFileUpload(false)}
				maxWidth="sm"
				fullWidth
			>
				<DialogTitle>Attach Files</DialogTitle>
				<DialogContent>
					{channelId && (
						<ChatFileUpload
							channelId={channelId}
							onUploadComplete={handleFileUploadComplete}
							onUploadError={handleFileUploadError}
							maxSizeBytes={100 * 1024 * 1024} // 100MB
							multiple={true}
						/>
					)}
					{!channelId && (
						<Typography variant="body2" color="text.secondary">
							File upload is only available in channels.
						</Typography>
					)}
				</DialogContent>
				<DialogActions>
					<Button onClick={() => setShowFileUpload(false)}>
						Close
					</Button>
				</DialogActions>
			</Dialog>
		</div>
	);
}
