#!/usr/bin/env node

/**
 * Standalone verification script for text extraction logic
 * Tests that line counting works correctly for LineNumberSidebar
 */

// Extract text from TipTap JSON
function extractText(node) {
	if (!node || typeof node !== 'object') return '';

	const n = node;

	// Hard break (line break within paragraph)
	if (n.type === 'hardBreak') {
		return '\n';
	}

	if (n.type === 'text' && typeof n.text === 'string') {
		return n.text;
	}

	if (Array.isArray(n.content)) {
		// For document root, join paragraphs with newlines
		if (n.type === 'doc') {
			return n.content.map(child => {
				if (child.type === 'paragraph') {
					// Extract paragraph content
					if (Array.isArray(child.content)) {
						return child.content.map(extractText).join('');
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

// Test cases
const tests = [
	{
		name: 'Single paragraph',
		json: {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [{ type: 'text', text: 'Hello World' }],
				},
			],
		},
		expectedLines: 1,
	},
	{
		name: 'Multiple paragraphs',
		json: {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [{ type: 'text', text: 'First paragraph' }],
				},
				{
					type: 'paragraph',
					content: [{ type: 'text', text: 'Second paragraph' }],
				},
				{
					type: 'paragraph',
					content: [{ type: 'text', text: 'Third paragraph' }],
				},
			],
		},
		expectedLines: 3,
	},
	{
		name: 'Hard break within paragraph',
		json: {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'Line 1' },
						{ type: 'hardBreak' },
						{ type: 'text', text: 'Line 2' },
					],
				},
			],
		},
		expectedLines: 2,
	},
	{
		name: 'Empty paragraphs',
		json: {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [{ type: 'text', text: 'First' }],
				},
				{
					type: 'paragraph',
					content: [],
				},
				{
					type: 'paragraph',
					content: [{ type: 'text', text: 'Third' }],
				},
			],
		},
		expectedLines: 3,
	},
];

console.log('Testing text extraction for LineNumberSidebar...\n');

let passed = 0;
let failed = 0;

tests.forEach((test) => {
	const text = extractText(test.json);
	const lines = text.split('\n');
	const actualLines = lines.length;

	const success = actualLines === test.expectedLines;

	if (success) {
		console.log(`✅ PASS: ${test.name}`);
		console.log(`   Expected: ${test.expectedLines} lines, Got: ${actualLines} lines`);
		passed++;
	} else {
		console.log(`❌ FAIL: ${test.name}`);
		console.log(`   Expected: ${test.expectedLines} lines, Got: ${actualLines} lines`);
		console.log(`   Text: "${text}"`);
		failed++;
	}
	console.log('');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);

process.exit(failed > 0 ? 1 : 0);
