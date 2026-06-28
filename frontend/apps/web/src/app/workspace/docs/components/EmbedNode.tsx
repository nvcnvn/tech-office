/**
 * TipTap Extension for Embedded Sections
 * Allows embedding sections from other documents with live content
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import React from 'react';
import EmbeddedSection from './EmbeddedSection';

// Extend TipTap Commands interface
declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		embed: {
			setEmbed: (attributes: {
				embedId?: string;
				citationUrl?: string;
				sourceDocumentId: string;
				sourceLineStart: number;
				sourceLineEnd: number;
				targetDocumentId?: string;
				targetLineStart?: number;
				targetLineEnd?: number;
				targetVersion?: number;
			}) => ReturnType;
		};
	}
}

// React component for rendering embed node
export const EmbedNodeView = (props: NodeViewProps) => {
	const embedId = props.node.attrs.embedId as string | undefined;
	const citationUrl = props.node.attrs.citationUrl as string | undefined;

	return (
		<NodeViewWrapper contentEditable={false}>
			<EmbeddedSection embedId={embedId} citationUrl={citationUrl} />
		</NodeViewWrapper>
	);
};

// TipTap extension definition
export const EmbedNode = Node.create({
	name: 'embed',

	group: 'block',

	atom: true,

	addAttributes() {
		return {
			embedId: {
				default: null,
				parseHTML: element => element.getAttribute('data-embed-id'),
				renderHTML: attributes => ({
					'data-embed-id': attributes.embedId,
				}),
			},
			citationUrl: {
				default: null,
				parseHTML: element => element.getAttribute('data-citation-url'),
				renderHTML: attributes => ({
					'data-citation-url': attributes.citationUrl,
				}),
			},
			sourceDocumentId: {
				default: null,
				parseHTML: element => element.getAttribute('data-source-document-id'),
				renderHTML: attributes => ({
					'data-source-document-id': attributes.sourceDocumentId,
				}),
			},
			sourceLineStart: {
				default: null,
				parseHTML: element => {
					const val = element.getAttribute('data-source-line-start');
					return val ? parseInt(val, 10) : null;
				},
				renderHTML: attributes => ({
					'data-source-line-start': attributes.sourceLineStart,
				}),
			},
			sourceLineEnd: {
				default: null,
				parseHTML: element => {
					const val = element.getAttribute('data-source-line-end');
					return val ? parseInt(val, 10) : null;
				},
				renderHTML: attributes => ({
					'data-source-line-end': attributes.sourceLineEnd,
				}),
			},
			targetDocumentId: {
				default: null,
				parseHTML: element => element.getAttribute('data-target-document-id'),
				renderHTML: attributes => ({
					'data-target-document-id': attributes.targetDocumentId,
				}),
			},
			targetLineStart: {
				default: null,
				parseHTML: element => {
					const val = element.getAttribute('data-target-line-start');
					return val ? parseInt(val, 10) : null;
				},
				renderHTML: attributes => ({
					'data-target-line-start': attributes.targetLineStart,
				}),
			},
			targetLineEnd: {
				default: null,
				parseHTML: element => {
					const val = element.getAttribute('data-target-line-end');
					return val ? parseInt(val, 10) : null;
				},
				renderHTML: attributes => ({
					'data-target-line-end': attributes.targetLineEnd,
				}),
			},
			targetVersion: {
				default: null,
				parseHTML: element => {
					const val = element.getAttribute('data-target-version');
					return val ? parseInt(val, 10) : null;
				},
				renderHTML: attributes => ({
					'data-target-version': attributes.targetVersion,
				}),
			},
		};
	},

	parseHTML() {
		return [
			{
				tag: 'div[data-type="embed"]',
			},
		];
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'embed' })];
	},

	addNodeView() {
		return ReactNodeViewRenderer(EmbedNodeView);
	},

	addCommands() {
		return {
			setEmbed: (attributes) => ({ commands }) => {
				return commands.insertContent({
					type: this.name,
					attrs: attributes,
				});
			},
		};
	},
});
