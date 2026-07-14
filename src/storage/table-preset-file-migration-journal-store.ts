import type { App } from 'obsidian';
import {
	TABLE_PRESET_FILE_MIGRATION_JOURNAL_VERSION,
	cloneTablePresetFileMigrationJournal,
	cloneTablePresetFileMigrationRecoveryRequired,
	isTablePresetFileMigrationJournalDataV1,
	isTablePresetFileMigrationJournalV1,
} from '../types/table-preset-file-migration';
import type {
	TablePresetFileMigrationJournalDataV1,
	TablePresetFileMigrationJournalRecoveryRequired,
	TablePresetFileMigrationJournalV1,
} from '../types/table-preset-file-migration';
import { preserveInvalidJsonFile, writeJsonSafely } from './storage-file-ops';
import type { WriteQueue } from './write-queue';

export class TablePresetFileMigrationJournalStore {
	private journal: TablePresetFileMigrationJournalV1 | null = null;
	private mutationQueue: Promise<void> = Promise.resolve();
	private writesSuspended = false;
	private writeSuspensionReason: string | null = null;
	private recoveryRequired: TablePresetFileMigrationJournalRecoveryRequired | null = null;

	constructor(
		private readonly app: App,
		private readonly writeQueue: WriteQueue,
		private readonly filePath: string,
	) {}

	async load(): Promise<TablePresetFileMigrationJournalV1 | null> {
		return this.enqueueMutation(async () => {
			const adapter = this.app.vault.adapter;
			if (!(await adapter.exists(this.filePath))) {
				this.journal = null;
				this.recoveryRequired = null;
				this.resumeWrites();
				return null;
			}

			let raw: string;
			try {
				raw = await adapter.read(this.filePath);
			} catch (error) {
				this.journal = null;
				this.suspendWrites(error instanceof Error ? error.message : String(error));
				console.warn('Operon: Failed to read table-preset-file-migration.json; journal writes suspended');
				return null;
			}

			try {
				const parsed: unknown = JSON.parse(raw);
				if (!isTablePresetFileMigrationJournalDataV1(parsed)) {
					throw new Error('Unsupported or invalid table preset file migration journal');
				}
				this.journal = cloneTablePresetFileMigrationJournal(parsed.journal);
				this.recoveryRequired = cloneTablePresetFileMigrationRecoveryRequired(parsed.recoveryRequired ?? null);
				if (this.recoveryRequired) {
					this.suspendWrites(`Table preset file migration journal recovery is required; backup: ${this.recoveryRequired.backupPath}`);
				} else {
					this.resumeWrites();
				}
				return this.get();
			} catch (error) {
				console.warn('Operon: Failed to load table-preset-file-migration.json, preserving invalid file as backup');
				this.journal = null;
				this.recoveryRequired = null;
				try {
					const recoveryRequired = await this.writeQueue.enqueue(this.filePath, async () => {
						const backupPath = await preserveInvalidJsonFile(adapter, this.filePath, raw);
						const recovery: TablePresetFileMigrationJournalRecoveryRequired = {
							kind: 'invalid-backup',
							backupPath,
							detectedAt: new Date().toISOString(),
						};
						await writeJsonSafely(adapter, this.filePath, {
							version: TABLE_PRESET_FILE_MIGRATION_JOURNAL_VERSION,
							journal: null,
							recoveryRequired: recovery,
						} satisfies TablePresetFileMigrationJournalDataV1);
						return recovery;
					});
					this.recoveryRequired = recoveryRequired;
					this.suspendWrites(`Table preset file migration journal recovery is required; backup: ${recoveryRequired.backupPath}`);
				} catch (backupError) {
					console.warn('Operon: Failed to preserve invalid table preset file migration journal backup; journal writes suspended');
					this.suspendWrites(backupError instanceof Error ? backupError.message : String(backupError));
				}
				if (error instanceof Error) console.warn(`Operon: ${error.message}`);
				return null;
			}
		});
	}

	get(): TablePresetFileMigrationJournalV1 | null {
		return cloneTablePresetFileMigrationJournal(this.journal);
	}

	canPersist(): boolean {
		return !this.writesSuspended;
	}

	getWriteSuspensionReason(): string | null {
		return this.writeSuspensionReason;
	}

	getRecoveryRequired(): TablePresetFileMigrationJournalRecoveryRequired | null {
		return cloneTablePresetFileMigrationRecoveryRequired(this.recoveryRequired);
	}

	async replace(journal: TablePresetFileMigrationJournalV1): Promise<void> {
		if (!isTablePresetFileMigrationJournalV1(journal)) {
			throw new Error('Cannot persist an invalid table preset file migration journal');
		}
		const candidate = cloneTablePresetFileMigrationJournal(journal)!;
		await this.enqueueMutation(async () => {
			if (this.journal && this.journal.runId !== candidate.runId) {
				throw new Error(`Cannot replace active table preset file migration run ${this.journal.runId}`);
			}
			await this.flush(candidate);
			this.journal = candidate;
		});
	}

	async clear(): Promise<void> {
		await this.enqueueMutation(async () => {
			await this.flush(null, this.recoveryRequired !== null);
			this.journal = null;
			this.recoveryRequired = null;
			this.resumeWrites();
		});
	}

	async drain(): Promise<void> {
		await this.mutationQueue;
	}

	private async flush(
		journal: TablePresetFileMigrationJournalV1 | null,
		allowRecoveryClear = false,
	): Promise<void> {
		if (this.writesSuspended && !allowRecoveryClear) {
			throw new Error(`Table preset file migration journal writes are suspended: ${this.writeSuspensionReason ?? 'invalid journal backup failed'}`);
		}
		if (allowRecoveryClear && !this.recoveryRequired) {
			throw new Error('Table preset file migration journal recovery cannot be cleared without a preserved backup');
		}
		const data: TablePresetFileMigrationJournalDataV1 = {
			version: TABLE_PRESET_FILE_MIGRATION_JOURNAL_VERSION,
			journal: cloneTablePresetFileMigrationJournal(journal),
		};
		await this.writeQueue.enqueue(this.filePath, async () => {
			await writeJsonSafely(this.app.vault.adapter, this.filePath, data);
		});
	}

	private async enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.mutationQueue.then(operation);
		this.mutationQueue = run.then(() => undefined, () => undefined);
		return run;
	}

	private suspendWrites(reason: string): void {
		this.writesSuspended = true;
		this.writeSuspensionReason = reason.trim() || 'Invalid table preset file migration journal backup failed';
	}

	private resumeWrites(): void {
		this.writesSuspended = false;
		this.writeSuspensionReason = null;
	}
}
