/**
 * Reasoning tag stripping for outbound Discord messages.
 *
 * Strips model reasoning/thinking tags from outbound messages before sending
 * to Discord. Many LLMs (Claude, DeepSeek, etc.) may leak internal reasoning
 * wrapped in XML-like tags that users should not see.
 *
 * Supported tags:
 *   <thinking>, <reasoning>, <reflection>, <scratchpad>,
 *   <thought>, <antthinking>
 *
 * Also strips self-closing model artifacts:
 *   <STOP/>, <END/>, <|end|>, etc.
 *
 * Features:
 * - Fast path: skips processing when no tags detected
 * - Preserves tags inside code blocks (backtick-fenced)
 * - Handles <final> wrapper (keeps content, removes tags)
 * - Handles nested/malformed tags gracefully
 * - Cleans up excess whitespace after stripping
 *
 * Ported from OCPlatform's shared/text/reasoning-tags.ts.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Tags to strip (case-insensitive). Content inside these is removed. */
const REASONING_TAGS = [
	"thinking",
	"reasoning",
	"reflection",
	"scratchpad",
	"thought",
	"antthinking",
] as const;

/** Self-closing model artifact tags to strip entirely (e.g. <STOP/>, <END/>) */
const SELF_CLOSING_ARTIFACTS_RE = /<(?:STOP|END|end_turn|eot_id)\s*\/?>|<\|(?:end|stop|im_end|eot_id)\|>/gi;

/** Quick check regex — if this doesn't match, skip all processing. */
const QUICK_TAG_RE = /<\/?(?:thinking|reasoning|reflection|scratchpad|thought|antthinking|final|STOP|END|end_turn)\b|<\|(?:end|stop|im_end)/i;

/** Regex to match fenced code blocks (``` ... ```) */
const CODE_BLOCK_RE = /```[\s\S]*?```/g;

/** Placeholder prefix for code block preservation */
const PLACEHOLDER_PREFIX = "\x00CB";

// ─────────────────────────────────────────────────────────────────────────────
// Main function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip reasoning tags from text, preserving code blocks.
 *
 * @param text - The text to process
 * @returns The text with reasoning tags and their content removed
 */
export function stripReasoningTags(text: string): string {
	if (!text) return text;

	// Fast path: no tags detected
	if (!QUICK_TAG_RE.test(text)) return text;

	// Step 1: Extract and preserve code blocks
	const codeBlocks: string[] = [];
	let processed = text.replace(CODE_BLOCK_RE, (match) => {
		const index = codeBlocks.length;
		codeBlocks.push(match);
		return `${PLACEHOLDER_PREFIX}${index}${PLACEHOLDER_PREFIX}`;
	});

	// Step 2: Strip self-closing model artifacts (<STOP/>, <END/>, etc.)
	processed = processed.replace(SELF_CLOSING_ARTIFACTS_RE, "");

	// Step 3: Strip each reasoning tag and its content
	for (const tag of REASONING_TAGS) {
		// Handle both self-closing and opening/closing pairs
		// Use a non-greedy match for content between tags
		const re = new RegExp(
			`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`,
			"gi",
		);
		processed = processed.replace(re, "");

		// Also handle unclosed tags (tag opened but never closed — strip to end)
		const unclosedRe = new RegExp(
			`<${tag}\\b[^>]*>[\\s\\S]*$`,
			"gi",
		);
		processed = processed.replace(unclosedRe, "");
	}

	// Step 4: Handle <final> wrapper — keep content, remove tags
	const finalRe = /<final\b[^>]*>([\s\S]*?)<\/final>/gi;
	processed = processed.replace(finalRe, "$1");

	// Step 5: Restore code blocks
	for (let i = 0; i < codeBlocks.length; i++) {
		processed = processed.replace(
			`${PLACEHOLDER_PREFIX}${i}${PLACEHOLDER_PREFIX}`,
			codeBlocks[i],
		);
	}

	// Step 6: Clean up excessive whitespace from stripping
	// Collapse 3+ consecutive newlines to 2
	processed = processed.replace(/\n{3,}/g, "\n\n");
	// Trim leading/trailing whitespace
	processed = processed.trim();

	return processed;
}
