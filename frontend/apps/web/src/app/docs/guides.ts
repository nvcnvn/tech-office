/**
 * The /docs help site is rendered from the markdown in `content/guides/`.
 * That markdown is the source of truth — editing a guide is editing the site.
 *
 * Everything here runs at build time. The pages are statically generated, so
 * the running server never reads these files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';

const GUIDES_DIR = path.join(process.cwd(), 'content', 'guides');
const INDEX_FILE = 'README.md';

export interface Guide {
	/** URL segment under /docs. The index has an empty slug. */
	slug: string;
	/** The document's `# ` heading. */
	title: string;
	/** Sort key from the filename prefix; the index sorts first. */
	order: number;
	html: string;
}

/** GitHub's heading-anchor rule, so in-document `#some-heading` links resolve. */
function slugifyHeading(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\w\s-]/g, '')
		.trim()
		.replace(/\s+/g, '-');
}

function fileToSlug(filename: string): string {
	if (filename === INDEX_FILE) return '';
	return filename.replace(/\.md$/, '').replace(/^\d+-/, '');
}

/**
 * Rewrites the links and image paths that make sense in a repository checkout
 * into the ones the site serves:
 *   images/foo.png                  -> /docs/foo.png
 *   02-run-your-daily-checklists.md -> /docs/run-your-daily-checklists/
 *   README.md                       -> /docs/
 * Anchors are preserved, and absolute URLs are left alone. The trailing slash
 * matches `trailingSlash: true` in next.config, so these links do not redirect.
 */
function rewriteHtml(html: string): string {
	return html
		.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_match, level: string, inner: string) => {
			const id = slugifyHeading(inner.replace(/<[^>]+>/g, ''));
			return `<h${level} id="${id}">${inner}</h${level}>`;
		})
		.replace(/src="images\/([^"]+)"/g, 'src="/docs/$1"')
		.replace(/href="([^":]+)\.md(#[^"]*)?"/g, (_match, file: string, anchor = '') => {
			const slug = fileToSlug(`${file}.md`);
			return `href="/docs/${slug ? `${slug}/` : ''}${anchor}"`;
		});
}

function readGuide(filename: string): Guide {
	const raw = fs.readFileSync(path.join(GUIDES_DIR, filename), 'utf8');
	const title = raw.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? filename;
	const order = filename === INDEX_FILE ? -1 : Number(filename.match(/^(\d+)-/)?.[1] ?? 99);

	return {
		slug: fileToSlug(filename),
		title,
		order,
		html: rewriteHtml(marked.parse(raw, { async: false })),
	};
}

let cache: Guide[] | undefined;

/** Every guide, index first, then by filename number. */
export function getGuides(): Guide[] {
	if (!cache) {
		cache = fs
			.readdirSync(GUIDES_DIR)
			.filter((name) => name.endsWith('.md'))
			.map(readGuide)
			.sort((left, right) => left.order - right.order);
	}
	return cache;
}

export function getGuide(slug: string): Guide | undefined {
	return getGuides().find((guide) => guide.slug === slug);
}

/** The guides excluding the index, in reading order — what the nav lists. */
export function getGuideNav(): Guide[] {
	return getGuides().filter((guide) => guide.slug !== '');
}
