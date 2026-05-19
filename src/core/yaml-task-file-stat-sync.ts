import { toLocalDatetime } from './local-time';

export interface YamlTaskFileStatInput {
	storedCreated: string;
	storedModified: string;
	mtime: number;
	ctime: number;
}

export interface YamlTaskEffectiveTimestamps {
	datetimeCreated: string;
	datetimeModified: string;
}

function normalizeStoredValue(value: string | null | undefined): string {
	return (value ?? '').trim();
}

function normalizeFileStatDatetime(value: number): string {
	if (!Number.isFinite(value) || value <= 0) return '';
	return toLocalDatetime(new Date(value));
}

function maxTimestamp(left: string, right: string): string {
	if (!left) return right;
	if (!right) return left;
	return left.localeCompare(right) >= 0 ? left : right;
}

export function resolveYamlTaskEffectiveTimestamps(
	input: YamlTaskFileStatInput,
): YamlTaskEffectiveTimestamps {
	const storedCreated = normalizeStoredValue(input.storedCreated);
	const storedModified = normalizeStoredValue(input.storedModified);
	const statCreated = normalizeFileStatDatetime(input.ctime);
	const statModified = normalizeFileStatDatetime(input.mtime);

	return {
		datetimeCreated: storedCreated || statCreated,
		datetimeModified: maxTimestamp(storedModified, statModified),
	};
}

export function resolveYamlTaskCreatedBackfillValue(ctime: number): string {
	return normalizeFileStatDatetime(ctime);
}
