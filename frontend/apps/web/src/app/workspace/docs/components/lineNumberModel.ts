export const EMBED_MARKDOWN_TOKEN_RE = /^\{\{embed:(.+?#L\d+(?:-L?\d+)?)\}\}$/i;

export type LineNumberBlockKind = 'heading' | 'blockquote' | 'listItem' | 'codeBlock' | 'embed' | 'paragraph';

export interface LineNumberBlock {
	kind: LineNumberBlockKind;
	lineStart: number;
	lineCount: number;
}

export interface LineNumberModel {
	lineCount: number;
	blocks: LineNumberBlock[];
	rawLines: string[];
}

interface TipTapNode {
	type?: string;
	text?: string;
	attrs?: Record<string, unknown>;
	content?: TipTapNode[];
}

export function splitLineNumberContent(content: string, trimFinalEmptyLine: boolean): string[] {
	const normalized = content.replace(/\r\n?/g, '\n');
	const lines = normalized.split('\n');

	if (trimFinalEmptyLine && lines.length > 1 && lines[lines.length - 1] === '') {
		return lines.slice(0, -1);
	}

	return lines;
}

export function buildMarkdownLineNumberModel(content: string, rendered: boolean): LineNumberModel {
	const rawLines = splitLineNumberContent(content, rendered);

	if (!rendered) {
		return {
			lineCount: rawLines.length,
			rawLines,
			blocks: rawLines.map((_, index) => ({
				kind: 'paragraph',
				lineStart: index,
				lineCount: 1,
			})),
		};
	}

	const blocks: LineNumberBlock[] = [];
	let rawIndex = 0;
	let renderedLineIndex = 0;

	const pushBlock = (kind: LineNumberBlockKind, lineCount: number) => {
		const normalizedLineCount = Math.max(1, lineCount);
		blocks.push({
			kind,
			lineStart: renderedLineIndex,
			lineCount: normalizedLineCount,
		});
		renderedLineIndex += normalizedLineCount;
	};

	while (rawIndex < rawLines.length) {
		const line = rawLines[rawIndex] ?? '';
		const trimmed = line.trim();

		if (!trimmed) {
			pushBlock('paragraph', 1);
			rawIndex += 1;
			continue;
		}

		if (EMBED_MARKDOWN_TOKEN_RE.test(trimmed)) {
			pushBlock('embed', 1);
			rawIndex += 1;
			continue;
		}

		if (line.startsWith('```')) {
			rawIndex += 1;
			let codeLineCount = 0;
			while (rawIndex < rawLines.length && !(rawLines[rawIndex] ?? '').startsWith('```')) {
				codeLineCount += 1;
				rawIndex += 1;
			}
			if (rawIndex < rawLines.length && (rawLines[rawIndex] ?? '').startsWith('```')) {
				rawIndex += 1;
			}
			pushBlock('codeBlock', codeLineCount);
			continue;
		}

		if (/^(#{1,3})\s+/.test(line)) {
			pushBlock('heading', 1);
			rawIndex += 1;
			continue;
		}

		if (line.startsWith('> ')) {
			let quoteLineCount = 0;
			while (rawIndex < rawLines.length && (rawLines[rawIndex] ?? '').startsWith('> ')) {
				quoteLineCount += 1;
				rawIndex += 1;
			}
			pushBlock('blockquote', quoteLineCount);
			continue;
		}

		if (/^[-*]\s+/.test(line)) {
			while (rawIndex < rawLines.length && /^[-*]\s+/.test(rawLines[rawIndex] ?? '')) {
				pushBlock('listItem', 1);
				rawIndex += 1;
			}
			continue;
		}

		let paragraphLineCount = 0;
		while (
			rawIndex < rawLines.length &&
			(rawLines[rawIndex] ?? '').trim() &&
			!/^(#{1,3}\s)/.test(rawLines[rawIndex] ?? '') &&
			!/^[-*]\s+/.test(rawLines[rawIndex] ?? '') &&
			!(rawLines[rawIndex] ?? '').startsWith('> ') &&
			!(rawLines[rawIndex] ?? '').startsWith('```') &&
			!EMBED_MARKDOWN_TOKEN_RE.test((rawLines[rawIndex] ?? '').trim())
		) {
			paragraphLineCount += 1;
			rawIndex += 1;
		}
		pushBlock('paragraph', paragraphLineCount);
	}

	return {
		lineCount: Math.max(1, renderedLineIndex),
		rawLines,
		blocks: blocks.length > 0 ? blocks : [{ kind: 'paragraph', lineStart: 0, lineCount: 1 }],
	};
}

export function extractRenderedLineRangeFromTipTapJson(
	contentJson: string,
	startLine: number,
	endLine: number,
): string | null {
	if (startLine <= 0 || endLine < startLine) return null;

	let doc: TipTapNode;
	try {
		doc = JSON.parse(contentJson) as TipTapNode;
	} catch {
		return null;
	}

	const lines = tipTapNodeToRenderedLines(doc);
	if (endLine > lines.length) return null;

	return lines.slice(startLine - 1, endLine).join('\n');
}

function tipTapNodeToRenderedLines(node: TipTapNode | undefined): string[] {
	if (!node) return [];

	switch (node.type) {
		case 'doc':
			return flattenChildLines(node);
		case 'paragraph':
			return splitRenderedInlineContent(node);
		case 'heading':
			return [renderInlineContent(node)];
		case 'bulletList':
		case 'orderedList':
			return flattenChildLines(node);
		case 'listItem':
			return [renderInlineContent(node).trim()];
		case 'blockquote':
			return splitRenderedInlineContent(node);
		case 'codeBlock': {
			const text = renderInlineContent(node);
			return text ? text.split('\n') : [''];
		}
		case 'embed':
			return ['[embedded section]'];
		default:
			if (node.content) return flattenChildLines(node);
			return [];
	}
}

function flattenChildLines(node: TipTapNode): string[] {
	const lines = node.content?.flatMap(child => tipTapNodeToRenderedLines(child)) ?? [];
	return lines.length > 0 ? lines : [''];
}

function splitRenderedInlineContent(node: TipTapNode): string[] {
	const text = renderInlineContent(node);
	return text ? text.split('\n') : [''];
}

function renderInlineContent(node: TipTapNode): string {
	if (node.type === 'text') return node.text ?? '';
	if (node.type === 'hardBreak') return '\n';
	return node.content?.map(renderInlineContent).join('') ?? '';
}