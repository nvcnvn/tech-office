/**
 * Canonical chat reaction emoji palette shared across web and mobile.
 */

const EMOJI_ENTRIES: Array<[string, string]> = [
	['👍', ':thumbsup:'],
	['👎', ':thumbsdown:'],
	['❤️', ':heart:'],
	['😂', ':joy:'],
	['😮', ':open_mouth:'],
	['😢', ':cry:'],
	['🎉', ':tada:'],
	['🚀', ':rocket:'],
	['👀', ':eyes:'],
	['🔥', ':fire:'],
	['✅', ':white_check_mark:'],
	['❌', ':x:'],
	['💯', ':100:'],
	['🙌', ':raised_hands:'],
	['👏', ':clap:'],
	['💪', ':muscle:'],
];

const EMOJI_TO_CODE: Record<string, string> = EMOJI_ENTRIES.reduce((acc, [emoji, code]) => {
	acc[emoji] = code;
	return acc;
}, {} as Record<string, string>);

const CODE_TO_EMOJI: Record<string, string> = EMOJI_ENTRIES.reduce((acc, [emoji, code]) => {
	acc[code] = emoji;
	return acc;
}, {} as Record<string, string>);

export const DEFAULT_REACTION_EMOJIS = EMOJI_ENTRIES.map(([emoji]) => emoji);

export const QUICK_REACTION_EMOJIS = ['👍', '👀', '✅'] as const;

export function emojiToCode(emoji: string): string {
	return EMOJI_TO_CODE[emoji] || emoji;
}

export function codeToEmoji(code: string): string {
	return CODE_TO_EMOJI[code] || code;
}

export function isEmojiCode(str: string): boolean {
	return str.length >= 3 && str.startsWith(':') && str.endsWith(':');
}