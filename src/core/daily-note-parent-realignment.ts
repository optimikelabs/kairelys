import { IndexedTask } from '../types/fields';

const DAILY_NOTE_DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/u;

export interface DailyNoteParentRealignmentInput {
	enabled: boolean;
	currentFieldValues: Record<string, string>;
	patch: Record<string, string>;
	currentParentTask: IndexedTask | null | undefined;
	dailyNotesFolder: string;
	mode?: 'merge' | 'replace';
}

export function isDailyNoteDateKey(value: string | null | undefined): boolean {
	return DAILY_NOTE_DATE_KEY_RE.test((value ?? '').trim());
}

export function resolveDailyNoteFilePath(dateKey: string, folder: string): string | null {
	const normalizedDate = dateKey.trim();
	if (!isDailyNoteDateKey(normalizedDate)) return null;
	const normalizedFolder = normalizeDailyNotesFolder(folder);
	return normalizedFolder ? `${normalizedFolder}/${normalizedDate}.md` : `${normalizedDate}.md`;
}

export function getDailyNoteDateKeyFromPath(filePath: string, folder: string): string | null {
	const normalizedPath = filePath.trim();
	const normalizedFolder = normalizeDailyNotesFolder(folder);
	const prefix = normalizedFolder ? `${normalizedFolder}/` : '';
	if (prefix && !normalizedPath.startsWith(prefix)) return null;

	const rest = prefix ? normalizedPath.slice(prefix.length) : normalizedPath;
	if (!rest || rest.includes('/')) return null;
	if (!rest.endsWith('.md')) return null;

	const dateKey = rest.slice(0, -'.md'.length);
	return isDailyNoteDateKey(dateKey) ? dateKey : null;
}

export function isDailyNoteFileTask(task: IndexedTask | null | undefined, folder: string): boolean {
	if (!task) return false;
	if (task.primary.format !== 'yaml') return false;
	return getDailyNoteDateKeyFromPath(task.primary.filePath, folder) !== null;
}

export function resolveDailyNoteParentRealignmentTargetDate({
	enabled,
	currentFieldValues,
	patch,
	currentParentTask,
	dailyNotesFolder,
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

	if (!isDailyNoteFileTask(currentParentTask, dailyNotesFolder)) return null;
	return nextScheduled;
}

function normalizeDailyNotesFolder(folder: string): string {
	return folder.trim().replace(/^\/+|\/+$/gu, '');
}

function normalizeFieldValue(value: string | null | undefined): string {
	return (value ?? '').trim();
}

function hasOwn(source: Record<string, string>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(source, key) === true;
}
