import { parseTaskLine, hasOperonFields } from './parser';
import { buildCanonicalLocalDatetime, deriveDatetimeEnd } from './scheduling-rules';
import { CheckboxState } from '../types/keys';

export type TasksEmojiToOperonResult =
	| {
		kind: 'converted';
		checkbox: CheckboxState;
		description: string;
		tags: string[];
		mappedFields: Record<string, string>;
		leftovers: string[];
	}
	| { kind: 'not_tasks_emoji' }
	| { kind: 'already_operon' }
	| { kind: 'hybrid_unsupported' };

interface TextRange {
	from: number;
	to: number;
}

interface LeadingTimeBlock {
	range: TextRange;
	raw: string;
	startTime: string;
	endTime: string | null;
}

const SUPPORTED_DATE_EMOJIS: Array<{ emoji: string; key: string }> = [
	{ emoji: '📅', key: 'dateDue' },
	{ emoji: '⏳', key: 'dateScheduled' },
	{ emoji: '🛫', key: 'dateStarted' },
	{ emoji: '✅', key: 'dateCompleted' },
	{ emoji: '❌', key: 'dateCancelled' },
	{ emoji: '➕', key: 'datetimeCreated' },
];

const PRIORITY_EMOJIS = ['⏫', '🔼', '🔽', '⏬'];
const UNSUPPORTED_LONG_EMOJIS = ['🆔', '⛔', '🔁'];
const UNSUPPORTED_SHORT_EMOJIS = ['⏰'];
const ALL_TASKS_METADATA_EMOJIS = [
	...SUPPORTED_DATE_EMOJIS.map(entry => entry.emoji),
	...PRIORITY_EMOJIS,
	...UNSUPPORTED_LONG_EMOJIS,
	...UNSUPPORTED_SHORT_EMOJIS,
];

function findMarkdownLinkRanges(text: string): TextRange[] {
	const ranges: TextRange[] = [];
	let i = 0;
	while (i < text.length) {
		if (text[i] !== '[' || text[i + 1] === '[') {
			i++;
			continue;
		}

		const labelEnd = text.indexOf(']', i + 1);
		if (labelEnd === -1 || text[labelEnd + 1] !== '(') {
			i++;
			continue;
		}

		let depth = 1;
		let j = labelEnd + 2;
		while (j < text.length) {
			const ch = text[j];
			if (ch === '(') depth++;
			if (ch === ')') {
				depth--;
				if (depth === 0) {
					ranges.push({ from: i, to: j + 1 });
					i = j + 1;
					break;
				}
			}
			j++;
		}

		if (j >= text.length) {
			i++;
		}
	}
	return ranges;
}

function rangeAt(ranges: TextRange[], index: number): TextRange | null {
	for (const range of ranges) {
		if (index >= range.from && index < range.to) return range;
	}
	return null;
}

function overlaps(left: TextRange, right: TextRange): boolean {
	return left.from < right.to && right.from < left.to;
}

function compressWhitespace(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

function normalizeCreatedDate(value: string): string {
	return `${value}T00:00:01`;
}

function detectLeadingTimeBlock(text: string): LeadingTimeBlock | null {
	const rangeMatch = /^(\s*)(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})(?=\s|$)/.exec(text);
	if (rangeMatch) {
		return {
			range: { from: 0, to: rangeMatch[0].length },
			raw: rangeMatch[0].trim(),
			startTime: rangeMatch[2],
			endTime: rangeMatch[3],
		};
	}

	const singleMatch = /^(\s*)(\d{1,2}:\d{2})(?=\s|$)/.exec(text);
	if (!singleMatch) return null;
	return {
		range: { from: 0, to: singleMatch[0].length },
		raw: singleMatch[0].trim(),
		startTime: singleMatch[2],
		endTime: null,
	};
}

function parseClockToSeconds(value: string): number | null {
	const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
	if (!match) return null;
	const hours = Number.parseInt(match[1], 10);
	const minutes = Number.parseInt(match[2], 10);
	if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
		return null;
	}
	return hours * 3600 + minutes * 60;
}

function buildTimedSchedulingFields(dateScheduled: string, timeBlock: LeadingTimeBlock): Record<string, string> | null {
	const datetimeStart = buildCanonicalLocalDatetime(dateScheduled, timeBlock.startTime);
	if (!datetimeStart) return null;

	if (!timeBlock.endTime) {
		const estimateSeconds = 15 * 60;
		return {
			datetimeStart,
			datetimeEnd: deriveDatetimeEnd(datetimeStart, estimateSeconds),
			estimate: String(estimateSeconds),
		};
	}

	const startSeconds = parseClockToSeconds(timeBlock.startTime);
	const endSeconds = parseClockToSeconds(timeBlock.endTime);
	if (startSeconds == null || endSeconds == null || endSeconds <= startSeconds) return null;

	const estimateSeconds = endSeconds - startSeconds;
	const datetimeEnd = buildCanonicalLocalDatetime(dateScheduled, timeBlock.endTime);
	if (!datetimeEnd) return null;
	return {
		datetimeStart,
		datetimeEnd,
		estimate: String(estimateSeconds),
	};
}

function findNextMetadataBoundary(text: string, from: number, protectedRanges: TextRange[]): number {
	for (let i = from; i < text.length; i++) {
		const protectedRange = rangeAt(protectedRanges, i);
		if (protectedRange) {
			i = protectedRange.to - 1;
			continue;
		}
		if (text.startsWith('%%[', i)) return i;
		if (text[i] === '[' || text[i] === '#') return i;
		for (const emoji of ALL_TASKS_METADATA_EMOJIS) {
			if (text.startsWith(emoji, i)) return i;
		}
	}
	return text.length;
}

function collectTodoistLikeFragments(text: string): Array<{ range: TextRange; value: string }> {
	const regex = /%%\[[^\]]+::[^\]]+\]%%|\b[a-z_]*id::\s*[^\s]+/gi;
	const fragments: Array<{ range: TextRange; value: string }> = [];
	for (const match of text.matchAll(regex)) {
		const value = match[0]?.trim();
		if (!value) continue;
		const index = match.index ?? -1;
		if (index < 0) continue;
		fragments.push({
			range: { from: index, to: index + match[0].length },
			value,
		});
	}
	return fragments;
}

function removeRanges(text: string, ranges: TextRange[]): string {
	if (ranges.length === 0) return text;
	const ordered = [...ranges].sort((left, right) => left.from - right.from);
	let cursor = 0;
	let result = '';
	for (const range of ordered) {
		if (range.from > cursor) result += text.slice(cursor, range.from);
		cursor = Math.max(cursor, range.to);
	}
	if (cursor < text.length) result += text.slice(cursor);
	return result;
}

function parseCheckboxState(raw: string): { checkbox: CheckboxState; leftover: string | null } | null {
	switch (raw) {
		case ' ':
			return { checkbox: 'open', leftover: null };
		case 'x':
		case 'X':
			return { checkbox: 'done', leftover: null };
		case '-':
			return { checkbox: 'cancelled', leftover: null };
		default:
			return { checkbox: 'open', leftover: `custom checkbox symbol: ${raw}` };
	}
}

export function convertTasksEmojiLineToOperon(line: string): TasksEmojiToOperonResult {
	const checkboxMatch = /^(\s*)- \[(.)\](\s*)/.exec(line);
	if (!checkboxMatch) return { kind: 'not_tasks_emoji' };

	const checkboxInfo = parseCheckboxState(checkboxMatch[2]);
	if (!checkboxInfo) return { kind: 'not_tasks_emoji' };

	const body = line.slice(checkboxMatch[0].length);
	const leadingTimeBlock = detectLeadingTimeBlock(body);
	const protectedRanges = findMarkdownLinkRanges(body);
	const rangesToRemove: TextRange[] = [];
	const leftovers: string[] = [];
	const mappedFields: Record<string, string> = {};
	let foundTasksSyntax = checkboxInfo.leftover !== null;

	if (checkboxInfo.leftover) leftovers.push(checkboxInfo.leftover);

	const pushRange = (range: TextRange): void => {
		if (rangesToRemove.some(existing => overlaps(existing, range))) return;
		rangesToRemove.push(range);
	};

	for (let i = 0; i < body.length; i++) {
		const protectedRange = rangeAt(protectedRanges, i);
		if (protectedRange) {
			i = protectedRange.to - 1;
			continue;
		}

		let matched = false;

		for (const entry of SUPPORTED_DATE_EMOJIS) {
			if (!body.startsWith(entry.emoji, i)) continue;
			let valueStart = i + entry.emoji.length;
			while (valueStart < body.length && /\s/.test(body[valueStart])) valueStart++;
			const dateMatch = /^(\d{4}-\d{2}-\d{2})(?=$|\s)/.exec(body.slice(valueStart));
			if (!dateMatch) continue;
			const fragment = body.slice(i, valueStart + dateMatch[1].length).trim();
			pushRange({ from: i, to: valueStart + dateMatch[1].length });
			foundTasksSyntax = true;
			const normalizedValue = entry.key === 'datetimeCreated'
				? normalizeCreatedDate(dateMatch[1])
				: dateMatch[1];
			if (Object.prototype.hasOwnProperty.call(mappedFields, entry.key)) {
				leftovers.push(fragment);
			} else {
				mappedFields[entry.key] = normalizedValue;
			}
			i = valueStart + dateMatch[1].length - 1;
			matched = true;
			break;
		}
		if (matched) continue;

		for (const emoji of PRIORITY_EMOJIS) {
			if (!body.startsWith(emoji, i)) continue;
			pushRange({ from: i, to: i + emoji.length });
			leftovers.push(emoji);
			foundTasksSyntax = true;
			i += emoji.length - 1;
			matched = true;
			break;
		}
		if (matched) continue;

		if (body.startsWith('⏰', i)) {
			let end = i + '⏰'.length;
			while (end < body.length && /\s/.test(body[end])) end++;
			const timeMatch = /^(\d{1,2}:\d{2})(?=$|\s)/.exec(body.slice(end));
			if (timeMatch) {
				pushRange({ from: i, to: end + timeMatch[1].length });
				leftovers.push(body.slice(i, end + timeMatch[1].length).trim());
				foundTasksSyntax = true;
				i = end + timeMatch[1].length - 1;
				continue;
			}
		}

		for (const emoji of UNSUPPORTED_LONG_EMOJIS) {
			if (!body.startsWith(emoji, i)) continue;
			let start = i + emoji.length;
			while (start < body.length && /\s/.test(body[start])) start++;
			const end = findNextMetadataBoundary(body, start, protectedRanges);
			const fragment = body.slice(i, end).trim();
			pushRange({ from: i, to: end });
			if (fragment) leftovers.push(fragment);
			foundTasksSyntax = true;
			i = Math.max(i, end - 1);
			matched = true;
			break;
		}
		if (matched) continue;
	}

	const hasOperon = hasOperonFields(line);
	if (hasOperon && foundTasksSyntax) return { kind: 'hybrid_unsupported' };
	if (hasOperon) return { kind: 'already_operon' };
	if (!foundTasksSyntax) return { kind: 'not_tasks_emoji' };

	const scheduledDate = mappedFields['dateScheduled'];
	if (scheduledDate && leadingTimeBlock) {
		pushRange(leadingTimeBlock.range);
		const timedFields = buildTimedSchedulingFields(scheduledDate, leadingTimeBlock);
		if (timedFields) {
			for (const [key, value] of Object.entries(timedFields)) {
				mappedFields[key] = value;
			}
		}
	}

	const withoutEmojiMetadata = removeRanges(body, rangesToRemove);
	const todoistFragments = collectTodoistLikeFragments(withoutEmojiMetadata);
	const todoistRanges: TextRange[] = [];
	for (const fragment of todoistFragments) {
		leftovers.push(fragment.value);
		todoistRanges.push(fragment.range);
	}
	const cleanedBody = compressWhitespace(removeRanges(withoutEmojiMetadata, todoistRanges));
	if (!cleanedBody) return { kind: 'not_tasks_emoji' };

	const checkboxChar = checkboxInfo.checkbox === 'done'
		? 'x'
		: checkboxInfo.checkbox === 'cancelled'
			? '-'
			: ' ';
	const sanitizedLine = `- [${checkboxChar}] ${cleanedBody}`;
	const parsed = parseTaskLine(sanitizedLine, 0, 'TasksEmojiConversion.md');
	if (!parsed || !parsed.description.trim()) return { kind: 'not_tasks_emoji' };

	return {
		kind: 'converted',
		checkbox: checkboxInfo.checkbox,
		description: parsed.description,
		tags: parsed.tags,
		mappedFields,
		leftovers,
	};
}
