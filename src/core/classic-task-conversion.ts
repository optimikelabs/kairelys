import { parseTaskLine } from './parser';
import { convertTasksEmojiLineToOperon } from './tasks-emoji-to-operon';
import { KeyMapping } from '../types/settings';

export type ClassicTaskConversionKind = 'tasksEmoji' | 'plainCheckbox' | 'none';

export function classifyClassicTaskConversionLine(
	line: string,
	filePath: string,
	keyMappings: KeyMapping[] = [],
): ClassicTaskConversionKind {
	const tasksEmojiConversion = convertTasksEmojiLineToOperon(line);
	if (tasksEmojiConversion.kind === 'converted') return 'tasksEmoji';
	if (tasksEmojiConversion.kind === 'already_operon' || tasksEmojiConversion.kind === 'hybrid_unsupported') {
		return 'none';
	}

	const parsed = parseTaskLine(line, 0, filePath, keyMappings);
	if (!parsed) return 'none';
	if (parsed.operonId) return 'none';
	if (parsed.fields.length > 0) return 'none';
	return 'plainCheckbox';
}
