/**
 * Deterministic text measurement. Browser measurement differs between machines and is not
 * available in the CLI, so node sizes are computed from Helvetica/Arial advance widths
 * (units per 1000 em) with a small safety margin for system-ui fonts.
 */

// Printable ASCII 32..126, regular weight.
const REGULAR = [
	278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
	556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
	611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
	667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
	222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
];
// Printable ASCII 32..126, bold weight.
const BOLD = [
	278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
	556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
	611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
	667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
	278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584
];
const MARGIN = 1.06;

function charWidth(code: number, bold: boolean): number {
	if (code >= 32 && code <= 126) return (bold ? BOLD : REGULAR)[code - 32];
	if (code >= 0x2e80) return 1000; // CJK and wider
	return 600;
}

export function textWidth(text: string, size: number, bold = false): number {
	let units = 0;
	for (const ch of text) units += charWidth(ch.codePointAt(0)!, bold);
	return Math.ceil((units / 1000) * size * MARGIN);
}

/** Greedy word wrap. Words longer than the line are broken. At most `maxLines` lines. */
export function wrapText(
	text: string,
	maxWidth: number,
	size: number,
	maxLines = Infinity,
	bold = false
): string[] {
	const lines: string[] = [];
	for (const para of text.split('\n')) {
		let line = '';
		for (const word of para.split(/\s+/).filter(Boolean)) {
			const candidate = line ? `${line} ${word}` : word;
			if (textWidth(candidate, size, bold) <= maxWidth) {
				line = candidate;
				continue;
			}
			if (line) lines.push(line);
			line = word;
			while (textWidth(line, size, bold) > maxWidth && line.length > 1) {
				let cut = line.length - 1;
				while (cut > 1 && textWidth(line.slice(0, cut), size, bold) > maxWidth) cut--;
				lines.push(line.slice(0, cut));
				line = line.slice(cut);
			}
		}
		lines.push(line);
	}
	if (lines.length > maxLines) {
		const kept = lines.slice(0, maxLines);
		kept[maxLines - 1] = truncate(`${kept[maxLines - 1]} ${lines[maxLines]}`, maxWidth, size, bold);
		return kept;
	}
	return lines;
}

export function truncate(text: string, maxWidth: number, size: number, bold = false): string {
	if (textWidth(text, size, bold) <= maxWidth) return text;
	let end = text.length;
	while (end > 0 && textWidth(text.slice(0, end) + '…', size, bold) > maxWidth) end--;
	return text.slice(0, end).trimEnd() + '…';
}

export const FONT_STACK =
	'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif';
export const MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
