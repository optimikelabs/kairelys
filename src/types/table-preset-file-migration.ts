export const TABLE_PRESET_FILE_MIGRATION_JOURNAL_VERSION = 1 as const;

export type TablePresetFileMigrationStatus =
	| 'pending'
	| 'running'
	| 'partial'
	| 'completed'
	| 'failed';

export type TablePresetFileMigrationItemOutcome =
	| 'pending'
	| 'staged'
	| 'migrated'
	| 'adopted'
	| 'blocked'
	| 'failed'
	| 'backed-up';

export type TablePresetFileMigrationItemClassification =
	| 'create'
	| 'adopt'
	| 'already-migrated'
	| 'blocked';

export interface TablePresetFileMigrationJournalItemV1 {
	presetId: string;
	presetName: string;
	legacyPath: string | null;
	targetPath: string | null;
	sourceFingerprint: string;
	targetFingerprint?: string;
	classification: TablePresetFileMigrationItemClassification;
	outcome: TablePresetFileMigrationItemOutcome;
	attemptCount: number;
	updatedAt: string;
	stagedPath?: string;
	backupPath?: string;
	relatedPaths?: string[];
	error?: string;
}

export interface TablePresetFileMigrationJournalV1 {
	version: typeof TABLE_PRESET_FILE_MIGRATION_JOURNAL_VERSION;
	runId: string;
	status: TablePresetFileMigrationStatus;
	destinationFolder: string;
	backupFolder: string;
	legacyIndexFingerprint?: string;
	items: TablePresetFileMigrationJournalItemV1[];
	startedAt: string;
	updatedAt: string;
	completedAt?: string;
	lastError?: string;
}

export interface TablePresetFileMigrationJournalRecoveryRequired {
	kind: 'invalid-backup';
	backupPath: string;
	detectedAt: string;
}

export interface TablePresetFileMigrationJournalDataV1 {
	version: typeof TABLE_PRESET_FILE_MIGRATION_JOURNAL_VERSION;
	journal: TablePresetFileMigrationJournalV1 | null;
	recoveryRequired?: TablePresetFileMigrationJournalRecoveryRequired;
}

export function cloneTablePresetFileMigrationJournal(
	journal: TablePresetFileMigrationJournalV1 | null,
): TablePresetFileMigrationJournalV1 | null {
	if (!journal) return null;
	return {
		...journal,
		items: journal.items.map(item => ({
			...item,
			relatedPaths: item.relatedPaths ? [...item.relatedPaths] : undefined,
		})),
	};
}

export function cloneTablePresetFileMigrationRecoveryRequired(
	recovery: TablePresetFileMigrationJournalRecoveryRequired | null,
): TablePresetFileMigrationJournalRecoveryRequired | null {
	return recovery ? { ...recovery } : null;
}

export function isTablePresetFileMigrationJournalDataV1(
	value: unknown,
): value is TablePresetFileMigrationJournalDataV1 {
	if (!isRecord(value)) return false;
	if (value.version !== TABLE_PRESET_FILE_MIGRATION_JOURNAL_VERSION) return false;
	if (value.journal !== null && !isTablePresetFileMigrationJournalV1(value.journal)) return false;
	if (value.recoveryRequired !== undefined && !isTablePresetFileMigrationRecoveryRequired(value.recoveryRequired)) return false;
	return !(value.journal && value.recoveryRequired);
}

export function isTablePresetFileMigrationJournalV1(
	value: unknown,
): value is TablePresetFileMigrationJournalV1 {
	if (!isRecord(value)) return false;
	return value.version === TABLE_PRESET_FILE_MIGRATION_JOURNAL_VERSION
		&& isNonEmptyString(value.runId)
		&& isTablePresetFileMigrationStatus(value.status)
		&& isNonEmptyString(value.destinationFolder)
		&& isNonEmptyString(value.backupFolder)
		&& isOptionalNonEmptyString(value.legacyIndexFingerprint)
		&& Array.isArray(value.items)
		&& value.items.every(isTablePresetFileMigrationJournalItemV1)
		&& hasUniquePresetIds(value.items)
		&& isNonEmptyString(value.startedAt)
		&& isNonEmptyString(value.updatedAt)
		&& isOptionalString(value.completedAt)
		&& isOptionalString(value.lastError);
}

export function isTablePresetFileMigrationJournalItemV1(
	value: unknown,
): value is TablePresetFileMigrationJournalItemV1 {
	return isRecord(value)
		&& isNonEmptyString(value.presetId)
		&& isNonEmptyString(value.presetName)
		&& isNullableNonEmptyString(value.legacyPath)
		&& isNullableNonEmptyString(value.targetPath)
		&& isNonEmptyString(value.sourceFingerprint)
		&& isOptionalNonEmptyString(value.targetFingerprint)
		&& isTablePresetFileMigrationItemClassification(value.classification)
		&& isTablePresetFileMigrationItemOutcome(value.outcome)
		&& isNonNegativeInteger(value.attemptCount)
		&& isNonEmptyString(value.updatedAt)
		&& isOptionalNonEmptyString(value.stagedPath)
		&& isOptionalNonEmptyString(value.backupPath)
		&& isOptionalStringArray(value.relatedPaths)
		&& isOptionalString(value.error);
}

export function isTablePresetFileMigrationStatus(value: unknown): value is TablePresetFileMigrationStatus {
	return value === 'pending'
		|| value === 'running'
		|| value === 'partial'
		|| value === 'completed'
		|| value === 'failed';
}

export function isTablePresetFileMigrationItemOutcome(
	value: unknown,
): value is TablePresetFileMigrationItemOutcome {
	return value === 'pending'
		|| value === 'staged'
		|| value === 'migrated'
		|| value === 'adopted'
		|| value === 'blocked'
		|| value === 'failed'
		|| value === 'backed-up';
}

export function isTablePresetFileMigrationItemClassification(
	value: unknown,
): value is TablePresetFileMigrationItemClassification {
	return value === 'create'
		|| value === 'adopt'
		|| value === 'already-migrated'
		|| value === 'blocked';
}

function isTablePresetFileMigrationRecoveryRequired(
	value: unknown,
): value is TablePresetFileMigrationJournalRecoveryRequired {
	return isRecord(value)
		&& value.kind === 'invalid-backup'
		&& isNonEmptyString(value.backupPath)
		&& isNonEmptyString(value.detectedAt);
}

function hasUniquePresetIds(items: TablePresetFileMigrationJournalItemV1[]): boolean {
	return new Set(items.map(item => item.presetId)).size === items.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function isNullableNonEmptyString(value: unknown): value is string | null {
	return value === null || isNonEmptyString(value);
}

function isOptionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === 'string';
}

function isOptionalNonEmptyString(value: unknown): value is string | undefined {
	return value === undefined || isNonEmptyString(value);
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
	return value === undefined
		|| (Array.isArray(value) && value.every(isNonEmptyString));
}
