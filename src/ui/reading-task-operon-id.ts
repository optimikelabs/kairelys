import { isValidOperonId } from '../core/id-generator';
import { buildReverseMapping } from '../core/yaml-fields';
import type { IndexedTask } from '../types/fields';
import type { KeyMapping } from '../types/settings';

export function extractReadingTaskOperonId(text: string, keyMappings: KeyMapping[] = []): string | null {
	const reverseMap = buildReverseMapping(keyMappings);
	const fieldRegex = /\{\{\s*([^{}]+?)\s*::\s*([^{}]*?)\s*\}\}/gu;
	let match: RegExpExecArray | null;
	while ((match = fieldRegex.exec(text)) !== null) {
		const sourceKey = match[1].trim();
		const canonicalKey = reverseMap.get(sourceKey) ?? sourceKey;
		if (canonicalKey !== 'operonId') continue;
		const value = match[2].trim();
		if (isValidOperonId(value)) return value;
	}
	return null;
}

export function resolveReadingInlineTaskFromText(
	text: string,
	sourcePath: string,
	getTask: (operonId: string) => IndexedTask | null | undefined,
	keyMappings: KeyMapping[] = [],
): IndexedTask | null {
	const operonId = extractReadingTaskOperonId(text, keyMappings);
	if (!operonId) return null;

	const task = getTask(operonId);
	if (!task || task.primary.format !== 'inline' || task.primary.filePath !== sourcePath) {
		return null;
	}
	return task;
}
