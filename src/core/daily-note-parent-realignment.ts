import { IndexedTask } from '../types/fields';
import {
	DEFAULT_DAILY_NOTE_FORMAT,
	dailyNotePathsMatch,
	isDailyNoteDateKey,
	resolveDailyNotePathFromDateKey,
} from './daily-note-path';

export interface DailyNoteParentRealignmentInput {
	enabled: boolean;
	currentFieldValues: Record<string, string>;
	patch: Record<string, string>;
	currentParentTask: IndexedTask | null | undefined;
	dailyNotesFolder: string;
	dailyNotesFormat?: string;
	mode?: 'merge' | 'replace';
}

export function resolveDailyNoteFilePath(dateKey: string, folder: string, format = DEFAULT_DAILY_NOTE_FORMAT): string | null {
	return resolveDailyNotePathFromDateKey(dateKey, { folder, format });
}

export function isDailyNoteFileTaskForDate(
	task: IndexedTask | null | undefined,
	dateKey: string,
	config: { folder: string; format?: string },
): boolean {
	if (!task) return false;
	if (task.primary.format !== 'yaml') return false;
	const expectedPath = resolveDailyNotePathFromDateKey(dateKey, config);
	return dailyNotePathsMatch(task.primary.filePath, expectedPath);
}

export function resolveDailyNoteParentRealignmentTargetDate({
	enabled,
	currentFieldValues,
	patch,
	currentParentTask,
	dailyNotesFolder,
	dailyNotesFormat = DEFAULT_DAILY_NOTE_FORMAT,
	mode = 'merge',
}: DailyNoteParentRealignmentInput): string | null {
	if (!enabled) return null;
	if (!hasOwn(patch, 'dateScheduled')) return null;

	const previousScheduled = normalizeFieldValue(currentFieldValues['dateScheduled']);
	const nextScheduled = normalizeFieldValue(patch['dateScheduled']);
	if (!isDailyNoteDateKey(previousScheduled)) return null;
	if (!isDailyNoteDateKey(nextScheduled)) return null;
	if (previousScheduled === nextScheduled) return null;

	const currentParentId = normalizeFieldValue(currentFieldValues['parentTask']);
	if (!currentParentId) return null;

	if (hasOwn(patch, 'parentTask')) {
		const patchedParentId = normalizeFieldValue(patch['parentTask']);
		if (patchedParentId !== currentParentId) return null;
	} else if (mode === 'replace') {
		return null;
	}

	if (!isDailyNoteFileTaskForDate(currentParentTask, previousScheduled, {
		folder: dailyNotesFolder,
		format: dailyNotesFormat,
	})) return null;
	return nextScheduled;
}

function normalizeFieldValue(value: string | null | undefined): string {
	return (value ?? '').trim();
}

function hasOwn(source: Record<string, string>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(source, key) === true;
}
