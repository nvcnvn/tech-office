const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
	const source = fs.readFileSync(filename, 'utf8');
	const output = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2020,
			esModuleInterop: true,
		},
	});
	module._compile(output.outputText, filename);
};

const {
	buildMarkdownLineNumberModel,
	extractRenderedLineRangeFromTipTapJson,
} = require('../src/app/workspace/docs/components/lineNumberModel.ts');

const snapshotPath = path.join(__dirname, '__snapshots__', 'docs-line-model.snap.json');

const markdownFixtures = {
	paragraphsAndBlankLines: 'Intro\nSecond visual line\n\nAfter blank\n',
	richMarkdownBlocks: '# Title\nIntro paragraph\n- One\n- Two\n> Quote one\n> Quote two\n```\nalpha\nbeta\n```\nAfter\n',
	embedOccupiesOneAnchor: 'Before\n{{embed:/workspace/docs?slug=source&v=7#L3-L12}}\nAfter\n',
	trailingGeneratedNewline: 'Only paragraph\n',
};

const tipTapFixture = {
	type: 'doc',
	content: [
		{
			type: 'heading',
			attrs: { level: 1 },
			content: [{ type: 'text', text: 'Title' }],
		},
		{
			type: 'paragraph',
			content: [
				{ type: 'text', text: 'Intro' },
				{ type: 'hardBreak' },
				{ type: 'text', text: 'Next' },
			],
		},
		{
			type: 'embed',
			attrs: {
				citationUrl: '/workspace/docs?slug=source&v=7#L3-L12',
			},
		},
		{
			type: 'codeBlock',
			content: [{ type: 'text', text: 'alpha\nbeta' }],
		},
		{
			type: 'bulletList',
			content: [
				{
					type: 'listItem',
					content: [
						{
							type: 'paragraph',
							content: [{ type: 'text', text: 'First item' }],
						},
					],
				},
				{
					type: 'listItem',
					content: [
						{
							type: 'paragraph',
							content: [{ type: 'text', text: 'Second item' }],
						},
					],
				},
			],
		},
	],
};

function buildActualSnapshot() {
	return {
		markdownModels: Object.fromEntries(
			Object.entries(markdownFixtures).map(([name, markdown]) => {
				const model = buildMarkdownLineNumberModel(markdown, true);
				return [name, {
					lineCount: model.lineCount,
					blocks: model.blocks,
					rawLines: model.rawLines,
				}];
			})
		),
		tipTapExtractions: {
			allLines: extractRenderedLineRangeFromTipTapJson(JSON.stringify(tipTapFixture), 1, 8),
			embedThroughCode: extractRenderedLineRangeFromTipTapJson(JSON.stringify(tipTapFixture), 4, 6),
			listOnly: extractRenderedLineRangeFromTipTapJson(JSON.stringify(tipTapFixture), 7, 8),
			outOfRange: extractRenderedLineRangeFromTipTapJson(JSON.stringify(tipTapFixture), 9, 9),
		},
	};
}

test('docs rendered line-number model matches snapshot', () => {
	const actual = buildActualSnapshot();

	if (process.env.UPDATE_DOC_LINE_SNAPSHOTS === '1') {
		fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
		fs.writeFileSync(snapshotPath, `${JSON.stringify(actual, null, 2)}\n`);
	}

	const expected = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
	assert.deepEqual(actual, expected);
});