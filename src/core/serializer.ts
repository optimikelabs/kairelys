/**
 * Operon task line serializer.
 * Writes ParsedTask back to canonical task line format.
 *
 * Based on Spec Sections 7.1 - 7.5.
 * Canonical order: checkbox, time prefix, description, tags, fields (ordered), datetimeModified last.
 */

import { CANONICAL_KEY_MAP } from '../types/keys';
import { OperonField, ParsedTask } from '../types/fields';
import { KeyMapping } from '../types/settings';
import { normalizeLegacyCreatedDatetime } from './yaml-fields';
import { normalizeTaskIconValue } from './task-icon-value';
import { normalizeTaskColorValue } from './task-color-value';
import { parseTaskLine } from './parser';

/**
 * Escape special characters in a field value for safe inline storage.
 */
function escapeValue(value: string): string {
	let result = '';
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (ch === '\\') {
			result += '\\\\';
		} else if (ch === '}' && i + 1 < value.length && value[i + 1] === '}') {
			result += '\\}';
		} else if (ch === '{' && i + 1 < value.length && value[i + 1] === '{') {
			result += '\\{';
		} else {
			result += ch;
		}
	}
	return result;
}

/**
 * Get the canonical sort position for a field key.
 * Known canonical keys get their defined position.
 * Unknown (custom) keys sort after the last explicit workflow key.
 * datetimeModified always sorts last among canonical keys.
 */
function getFieldSortPosition(key: string): number {
	const def = CANONICAL_KEY_MAP.get(key);
	if (def) return def.position;
	return 30.5;
}

/**
 * Sort fields into canonical order (Spec Section 7.2).
 * operonId first, datetimeModified last, everything else by position.
 * Custom keys sort alphabetically among themselves.
 */
function sortFieldsCanonical(fields: OperonField[]): OperonField[] {
	return [...fields].sort((a, b) => {
		const posA = getFieldSortPosition(a.key);
		const posB = getFieldSortPosition(b.key);
		if (posA !== posB) return posA - posB;
		// Same position (both custom) → alphabetical
		return a.key.localeCompare(b.key);
	});
}

/**
 * Serialize a single field to its inline format: {{key:: value}}
 */
function getSerializedKeyName(field: OperonField, _keyMappings: KeyMapping[]): string {
	if (field.key === 'datetimeCreated' && field.sourceKey === 'dateCreated') {
		return field.key;
	}
	if (field.sourceKey) return field.sourceKey;
	return field.key;
}

export function serializeField(field: OperonField, keyMappings: KeyMapping[] = []): string {
	const normalizedValue = field.key === 'datetimeCreated'
		? normalizeLegacyCreatedDatetime(field.value)
		: field.key === 'taskIcon'
			? normalizeTaskIconValue(field.value)
			: field.key === 'taskColor'
				? normalizeTaskColorValue(field.value)
			: field.value;
	const escapedValue = escapeValue(normalizedValue);
	const keyName = getSerializedKeyName(field, keyMappings);
	if (!escapedValue) {
		return `{{${keyName}::}}`;
	}
	return `{{${keyName}:: ${escapedValue}}}`;
}

/**
 * Serialize a complete ParsedTask back to its canonical task line format.
 *
 * Format: - [STATUS] TIME DESCRIPTION #tags {{operonId:: x}} {{fields}} {{datetimeModified:: x}}
 */
export function serializeTask(task: ParsedTask, keyMappings: KeyMapping[] = []): string {
	const parts: string[] = [];

	// 1. Checkbox
	let checkboxChar: string;
	switch (task.checkbox) {
		case 'done': checkboxChar = 'x'; break;
		case 'cancelled': checkboxChar = '-'; break;
		default: checkboxChar = ' ';
	}
	parts.push(`- [${checkboxChar}]`);

	// 2. Optional time prefix
	if (task.timePrefix) {
		parts.push(task.timePrefix.raw);
	}

	// 3. Description text
	if (task.description) {
		parts.push(task.description);
	}

	// 4. Tags (Obsidian-native, outside containers)
	for (const tag of task.tags) {
		parts.push(`#${tag}`);
	}

	// 5. Fields in canonical order
	const sortedFields = sortFieldsCanonical(task.fields);
	for (const field of sortedFields) {
		parts.push(serializeField(field, keyMappings));
	}

	const indent = task.rawLine ? task.rawLine.slice(0, task.checkboxRange.from) : '';
	return `${indent}${parts.join(' ')}`;
}

/**
 * Normalize a task line: parse it and serialize it back to canonical format.
 * This reorders fields, normalizes spacing, and ensures canonical structure.
 */
export function normalizeTaskLine(line: string, lineNumber: number, filePath: string): string | null {
	const task = parseTaskLine(line, lineNumber, filePath);
	if (!task) return null;
	return serializeTask(task);
}

/**
 * Build a canonical task line from individual components.
 * Useful for creating new tasks programmatically.
 */
export function buildTaskLine(
	description: string,
	fields: Record<string, string>,
	options?: {
		checkbox?: 'open' | 'done' | 'cancelled';
		timePrefix?: string;
		tags?: string[];
	}
): string {
	const parts: string[] = [];

	// Checkbox
	const checkboxChar = options?.checkbox === 'done' ? 'x' :
	                     options?.checkbox === 'cancelled' ? '-' : ' ';
	parts.push(`- [${checkboxChar}]`);

	// Time prefix
	if (options?.timePrefix) {
		parts.push(options.timePrefix);
	}

	// Description
	if (description) {
		parts.push(description);
	}

	// Tags
	if (options?.tags) {
		for (const tag of options.tags) {
			parts.push(`#${tag}`);
		}
	}

	// Build OperonField array for sorting
	const operonFields: OperonField[] = Object.entries(fields).map(([key, value]) => ({
		sourceKey: key,
		key,
		value,
		rawValue: value,
		type: CANONICAL_KEY_MAP.get(key)?.type ?? 'text',
		isCanonical: CANONICAL_KEY_MAP.has(key),
		containerRange: { from: 0, to: 0 },
		valueRange: { from: 0, to: 0 },
	}));

	const sortedFields = sortFieldsCanonical(operonFields);
	for (const field of sortedFields) {
		parts.push(serializeField(field));
	}

	return parts.join(' ');
}
