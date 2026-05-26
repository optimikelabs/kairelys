import { CheckboxState } from '../types/keys';

export interface MarkdownCheckboxListItem {
	indent: string;
	indentWidth: number;
	checkbox: CheckboxState;
	description: string;
}

export function measureMarkdownIndent(line: string): number {
	let indent = 0;
	for (const char of line) {
		if (char === ' ') {
			indent += 1;
		} else if (char === '\t') {
			indent += 4;
		} else {
			break;
		}
	}
	return indent;
}

export function normalizeMarkdownCheckboxMarker(line: string): string | null {
	const match = /^(\s*)[-*+][ \t]+\[(.)\]([ \t]*)/.exec(line);
	if (!match) return null;
	return `${match[1]}- [${match[2]}]${match[3]}${line.slice(match[0].length)}`;
}

function parseMarkdownCheckboxState(raw: string): CheckboxState | null {
	switch (raw) {
		case ' ':
			return 'open';
		case 'x':
		case 'X':
			return 'done';
		case '-':
			return 'cancelled';
		default:
			return null;
	}
}

export function extractMarkdownCheckboxListItem(line: string): MarkdownCheckboxListItem | null {
	const match = /^(\s*)[-*+][ \t]+\[(.)\][ \t]*(.*)$/.exec(line);
	if (!match) return null;

	const checkbox = parseMarkdownCheckboxState(match[2]);
	if (!checkbox) return null;

	const description = match[3].trim();
	if (!description) return null;

	return {
		indent: match[1],
		indentWidth: measureMarkdownIndent(match[1]),
		checkbox,
		description,
	};
}

export function extractMarkdownListItemDescription(line: string): string | null {
	const trimmed = line.replace(/^\s+/, '');
	const match = /^([-*+]|\d+[.)])\s+(.+)$/.exec(trimmed);
	const description = match?.[2]?.trim() ?? '';
	if (!description || /^\[[^\]]\](?:\s|$)/.test(description)) return null;
	return description;
}
