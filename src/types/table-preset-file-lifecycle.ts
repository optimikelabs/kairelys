import type { TablePreset } from './table';

export const TABLE_PRESET_FILE_LIFECYCLE_RECEIPT_VERSION = 1 as const;
export const TABLE_PRESET_FILE_MIGRATION_FINALIZED_VERSION = 1 as const;

export type TablePresetFileFinalizationStatus = 'finalizing' | 'finalized' | 'cleanup-failed';

export type TablePresetFileCleanupManifestKind =
	| 'backup-index'
	| 'backup-preset'
	| 'migration-journal';

export interface TablePresetFileCleanupManifestEntryV1 {
	kind: TablePresetFileCleanupManifestKind;
	path: string;
	fingerprint: string;
}

export interface TablePresetFileMigrationReceiptV1 {
	version: typeof TABLE_PRESET_FILE_LIFECYCLE_RECEIPT_VERSION;
	migrationVersion: 1;
	runId: string;
	completedAt: string;
	finalizedAt: string;
	presetCount: number;
	backupFingerprint: string;
	backupDisposition: 'permanently-deleted';
	status: TablePresetFileFinalizationStatus;
	cleanupManifest: TablePresetFileCleanupManifestEntryV1[];
	lastError?: string;
}

export type TablePresetFileLifecycleProblemCode =
	| 'migration-not-completed'
	| 'migration-recovery-required'
	| 'migration-item-incomplete'
	| 'duplicate-binding-id'
	| 'duplicate-binding-path'
	| 'missing-binding-file'
	| 'invalid-binding-file'
	| 'binding-id-mismatch'
	| 'duplicate-table-file-id'
	| 'unbound-table-file'
	| 'invalid-table-file'
	| 'registry-conflict'
	| 'registry-missing'
	| 'backup-missing'
	| 'backup-invalid'
	| 'backup-fingerprint-mismatch'
	| 'journal-unavailable';

export interface TablePresetFileLifecycleProblem {
	code: TablePresetFileLifecycleProblemCode;
	message: string;
	presetId?: string;
	paths: string[];
}

export interface TablePresetFileFinalizationPreflightResult {
	ok: boolean;
	runId: string | null;
	completedAt: string | null;
	presetCount: number;
	backupFingerprint: string | null;
	cleanupManifest: TablePresetFileCleanupManifestEntryV1[];
	problems: TablePresetFileLifecycleProblem[];
}

export interface TablePresetFileBackupRecoveryRequest {
	presetId: string;
	destinationFolder?: string;
}

export interface TablePresetFileBackupRecoveryResult {
	sourcePresetId: string;
	createdPreset: TablePreset;
	path: string;
	sourceBackupPath: string;
	sourceFingerprint: string;
}

export interface TablePresetFileConflictResolutionRequest {
	presetId: string;
	chosenOriginalPath: string;
}

export interface TablePresetFileConflictResolutionSuccess {
	sourcePath: string;
	path: string;
	oldPresetId: string;
	preset: TablePreset;
	sourceFingerprint: string;
	targetFingerprint: string;
}

export interface TablePresetFileConflictResolutionFailure {
	path: string;
	error: string;
}

export interface TablePresetFileConflictResolutionResult {
	presetId: string;
	chosenOriginalPath: string;
	succeeded: TablePresetFileConflictResolutionSuccess[];
	failed: TablePresetFileConflictResolutionFailure[];
}

export interface TablePresetFileLifecycleOptions {
	receiptPath?: string;
	journalPath?: string;
	now?: () => Date;
	createPresetId?: () => string;
}

export interface TablePresetFileFinalizeOptions {
	commitFinalizedVersion: (version: typeof TABLE_PRESET_FILE_MIGRATION_FINALIZED_VERSION) => Promise<void>;
}

export function cloneTablePresetFileMigrationReceipt(
	receipt: TablePresetFileMigrationReceiptV1,
): TablePresetFileMigrationReceiptV1 {
	return {
		...receipt,
		cleanupManifest: receipt.cleanupManifest.map(entry => ({ ...entry })),
	};
}

export function isTablePresetFileMigrationReceiptV1(
	value: unknown,
): value is TablePresetFileMigrationReceiptV1 {
	if (!isRecord(value)) return false;
	return value.version === TABLE_PRESET_FILE_LIFECYCLE_RECEIPT_VERSION
		&& value.migrationVersion === 1
		&& isNonEmptyString(value.runId)
		&& isNonEmptyString(value.completedAt)
		&& typeof value.finalizedAt === 'string'
		&& isNonNegativeInteger(value.presetCount)
		&& isNonEmptyString(value.backupFingerprint)
		&& value.backupDisposition === 'permanently-deleted'
		&& isFinalizationStatus(value.status)
		&& Array.isArray(value.cleanupManifest)
		&& value.cleanupManifest.every(isCleanupManifestEntry)
		&& hasUniqueManifestPaths(value.cleanupManifest)
		&& (value.lastError === undefined || typeof value.lastError === 'string');
}

function isCleanupManifestEntry(value: unknown): value is TablePresetFileCleanupManifestEntryV1 {
	return isRecord(value)
		&& (value.kind === 'backup-index' || value.kind === 'backup-preset' || value.kind === 'migration-journal')
		&& isNonEmptyString(value.path)
		&& isNonEmptyString(value.fingerprint);
}

function isFinalizationStatus(value: unknown): value is TablePresetFileFinalizationStatus {
	return value === 'finalizing' || value === 'finalized' || value === 'cleanup-failed';
}

function hasUniqueManifestPaths(entries: TablePresetFileCleanupManifestEntryV1[]): boolean {
	return new Set(entries.map(entry => entry.path.toLocaleLowerCase('en-US'))).size === entries.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
