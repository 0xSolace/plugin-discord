/**
 * Reasoning Tag Stripping
 *
 * Strips `<thinking>`, `<reasoning>`, `<reflection>`, and similar XML-style
 * reasoning tags from outbound messages. Some models (Claude, DeepSeek, etc.)
 * include reasoning blocks in their output that shouldn't be shown to users.
 *
 * Inspired by OpenClaw's `shared/text/reasoning-tags.ts`.
 *
 * @module reasoning-tags
 */

/**
 * Quick check regex to avoid expensive processing on strings without any tags.
 */
const QUICK_TAG_RE =
	/<\s*\/?\s*(?:think(?:ing)?|thought|antthinking|reasoning|reflection|scratchpad|final)\b/i;

/**
 * Matches opening and closing thinking-family tags.
 * Captures group 1 = "/" if it's a closing tag.
 */
const THINKING_TAG_RE =
	/<\s*(\/?)\s*(?:think(?:ing)?|thought|antthinking|reasoning|reflection|scratchpad)\b[^<>]*>/gi;

/**
 * Matches `<final>` / `</final>` tags that some models use to wrap their actual response.
 */
const FINAL_TAG_RE = /<\s*\/?\s*final\b[^<>]*>/gi;

/**
 * Simple code block detection to avoid stripping tags inside code blocks.
 * Returns an array of [start, end] ranges for code blocks.
 */
function findCodeRegions(text: string): Array<[number, number]> {
	const regions: Array<[number, number]> = [];
	const codeBlockRe = /```[\s\S]*?```|`[^`\n]+`/g;
	let match: RegExpExecArray | null;

	while ((match = codeBlockRe.exec(text)) !== null) {
		regions.push([match.index, match.index + match[0].length]);
	}

	return regions;
}

/**
 * Checks if a position is inside a code region.
 */
function isInsideCode(
	position: number,
	codeRegions: Array<[number, number]>,
): boolean {
	for (const [start, end] of codeRegions) {
		if (position >= start && position < end) {
			return true;
		}
	}
	return false;
}

/**
 * Strips reasoning tags and their content from text.
 *
 * Handles:
 * - `<thinking>...</thinking>`
 * - `<thought>...</thought>`
 * - `<antthinking>...</antthinking>`
 * - `<reasoning>...</reasoning>`
 * - `<reflection>...</reflection>`
 * - `<scratchpad>...</scratchpad>`
 * - `<final>` / `</final>` wrapper tags (content preserved, tags removed)
 *
 * Preserves tags inside code blocks (backtick-fenced).
 *
 * @param text - The text to strip reasoning tags from
 * @returns The cleaned text with reasoning content removed
 */
export function stripReasoningTags(text: string): string {
	if (!text) {
		return text;
	}

	// Fast path: no tags detected at all
	if (!QUICK_TAG_RE.test(text)) {
		return text;
	}

	let cleaned = text;

	// Step 1: Strip <final> wrapper tags (keep content between them)
	if (FINAL_TAG_RE.test(cleaned)) {
		FINAL_TAG_RE.lastIndex = 0;
		const codeRegions = findCodeRegions(cleaned);
		const finalMatches: Array<{
			start: number;
			length: number;
			inCode: boolean;
		}> = [];

		for (const match of cleaned.matchAll(FINAL_TAG_RE)) {
			const start = match.index ?? 0;
			finalMatches.push({
				start,
				length: match[0].length,
				inCode: isInsideCode(start, codeRegions),
			});
		}

		// Remove from end to start to preserve indices
		for (let i = finalMatches.length - 1; i >= 0; i--) {
			const m = finalMatches[i];
			if (!m.inCode) {
				cleaned = cleaned.slice(0, m.start) + cleaned.slice(m.start + m.length);
			}
		}
	} else {
		FINAL_TAG_RE.lastIndex = 0;
	}

	// Step 2: Strip thinking/reasoning tags and their content
	const codeRegions = findCodeRegions(cleaned);
	THINKING_TAG_RE.lastIndex = 0;

	let result = "";
	let lastIndex = 0;
	let inThinking = false;

	for (const match of cleaned.matchAll(THINKING_TAG_RE)) {
		const idx = match.index ?? 0;
		const isClose = match[1] === "/";

		// Skip tags inside code blocks
		if (isInsideCode(idx, codeRegions)) {
			continue;
		}

		if (!inThinking) {
			// Not currently inside a thinking block
			result += cleaned.slice(lastIndex, idx);
			if (!isClose) {
				inThinking = true;
			}
		} else if (isClose) {
			// Closing a thinking block
			inThinking = false;
		}
		// If inThinking and not a close tag, we're nested or malformed: skip content

		lastIndex = idx + match[0].length;
	}

	// Append remainder (if we ended while still in a thinking block, drop the rest)
	if (!inThinking) {
		result += cleaned.slice(lastIndex);
	}

	return result.trim();
}
