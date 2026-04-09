/**
 * Smart chunking for draft stream progressive display.
 *
 * Splits response text on natural boundaries (paragraphs, sentences)
 * with minimum chunk sizes to avoid excessive edits.
 *
 * Ported from OpenClaw's draft-chunking.ts, simplified for plugin use.
 */

export type BreakPreference = "paragraph" | "newline" | "sentence";

export interface DraftChunkConfig {
	/** Minimum characters before first display (default: 80) */
	minChars: number;
	/** Maximum characters per message (Discord limit: 2000) */
	maxChars: number;
	/** Where to prefer breaking text (default: "sentence") */
	breakPreference: BreakPreference;
}

export const DEFAULT_DRAFT_CHUNK_CONFIG: DraftChunkConfig = {
	minChars: 80,
	maxChars: 1900, // leave headroom under Discord's 2000
	breakPreference: "sentence",
};

/**
 * Find the best break point in text up to maxLen.
 * Tries paragraph breaks first, then newlines, then sentence ends.
 * Falls back to word boundaries, then hard cut.
 */
export function findBreakPoint(
	text: string,
	maxLen: number,
	breakPreference: BreakPreference = "sentence",
): number {
	if (text.length <= maxLen) return text.length;

	const region = text.slice(0, maxLen);

	// Try paragraph break (double newline)
	if (breakPreference === "paragraph" || breakPreference === "newline") {
		const paraBreak = region.lastIndexOf("\n\n");
		if (paraBreak > maxLen * 0.3) return paraBreak + 2;
	}

	// Try newline break
	if (breakPreference !== "sentence") {
		const nlBreak = region.lastIndexOf("\n");
		if (nlBreak > maxLen * 0.3) return nlBreak + 1;
	}

	// Try sentence break (. ! ?)
	const sentenceMatch = region.match(/[.!?]\s+(?=[A-Z])/g);
	if (sentenceMatch) {
		const lastSentenceEnd = region.lastIndexOf(sentenceMatch[sentenceMatch.length - 1]);
		if (lastSentenceEnd > maxLen * 0.3) {
			return lastSentenceEnd + sentenceMatch[sentenceMatch.length - 1].length;
		}
	}

	// Simpler sentence end (period/bang/question followed by space)
	const simpleSentence = region.lastIndexOf(". ");
	if (simpleSentence > maxLen * 0.3) return simpleSentence + 2;

	// Word boundary
	const wordBreak = region.lastIndexOf(" ");
	if (wordBreak > maxLen * 0.5) return wordBreak + 1;

	// Hard cut
	return maxLen;
}
