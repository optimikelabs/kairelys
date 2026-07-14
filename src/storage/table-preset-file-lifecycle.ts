import { App, TFile } from 'obsidian';
import {
	cloneTablePreset,
	createTablePresetId,
	isSafeTablePresetId,
	type TablePreset,
	type TablePresetFileBinding,
} from '../types/table';
import type { OperonTableFileDescriptor } from '../types/table-file';
import {
	TABLE_PRESET_FILE_LIFECYCLE_RECEIPT_VERSION,
	TABLE_PRESET_FILE_MIGRATION_FINALIZED_VERSION,
	cloneTablePresetFileMigrationReceipt,
	isTablePresetFileMigrationReceiptV1,
	type TablePresetFileBackupRecoveryRequest,
	type TablePresetFileBackupRecoveryResult,
	type TablePresetFileCleanupManifestEntryV1,
	type TablePresetFileConflictResolutionFailure,
	type TablePresetFileConflictResolutionRequest,
	type TablePresetFileConflictResolutionResult,
	type TablePresetFileConflictResolutionSuccess,
	type TablePresetFileFinalizationPreflightResult,
	type TablePresetFileFinalizeOptions,
	type TablePresetFileLifecycleOptions,
	type TablePresetFileLifecycleProblem,
	type TablePresetFileLifecycleProblemCode,
	type TablePresetFileMigrationReceiptV1,
} from '../types/table-preset-file-lifecycle';
import type { OperonStorage } from './operon-storage';
import { buildTablePresetSemanticSignature } from './table-preset-file-migration';
import { readLegacyTablePresetSidecar, TABLE_PRESET_FILE_MIGRATION_VERSION } from './table-preset-file-migration-runner';
import type { TablePresetRegistry } from './table-preset-registry';
import {
	buildUniqueOperonTableFilePath,
	getOperonTableFilePathKey,
	isOperonTableFilePath,
	normalizeOperonTableFilePath,
	parseOperonTableFile,
	serializeOperonTableFile,
} from './table-file';
import { joinVaultPath } from './operon-storage-paths';
import { writeJsonSafely } from './storage-file-ops';

const DEFAULT_DESTINATION_FOLDER = 'Operon/Tables';

interface ValidTableFile {
	file: TFile;
	path: string;
	preset: TablePreset;
	source: string;
	fingerprint: string;
}

interface TableFileScan {
	valid: ValidTableFile[];
	invalid: Array<{ path: string; message: string }>;
}

export class TablePresetFileLifecycle<
	TDescriptor extends OperonTableFileDescriptor = OperonTableFileDescriptor,
> {
	private readonly now: () => Date;
	private readonly createPresetId: () => string;
	private readonly receiptPath: string;
	private readonly journalPath: string;
	private mutationQueue: Promise<void> = Promise.resolve();

	constructor(
		private readonly app: App,
		private readonly storage: OperonStorage,
		private readonly registry: TablePresetRegistry<TDescriptor>,
		options: TablePresetFileLifecycleOptions = {},
	) {
		this.now = options.now ?? (() => new Date());
		this.createPresetId = options.createPresetId ?? createTablePresetId;
		const stateFolder = derivePluginStateFolder(storage.tablePresetFileMigrationBackupRootPath);
		this.receiptPath = options.receiptPath
			?? joinVaultPath(stateFolder, 'table-preset-file-migration-receipt.json');
		this.journalPath = options.journalPath
			?? joinVaultPath(stateFolder, 'table-preset-file-migration.json');
		if (pathsEqual(this.receiptPath, this.journalPath)) {
			throw new Error('Table preset lifecycle receipt and migration journal paths must differ.');
		}
		if (isPathInside(this.receiptPath, storage.tablePresetFileMigrationBackupRootPath)) {
			throw new Error('Table preset lifecycle receipt must be outside the migration backup root.');
		}
	}

	getReceiptPath(): string {
		return this.receiptPath;
	}

	async loadReceipt(): Promise<TablePresetFileMigrationReceiptV1 | null> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.receiptPath))) return null;
		const parsed: unknown = JSON.parse(await adapter.read(this.receiptPath));
		if (!isTablePresetFileMigrationReceiptV1(parsed)) {
			throw new Error(`Invalid Table preset file lifecycle receipt: ${this.receiptPath}`);
		}
		return cloneTablePresetFileMigrationReceipt(parsed);
	}

	async reconcileFinalizedReceipt(finalizedVersion: number): Promise<TablePresetFileMigrationReceiptV1 | null> {
		return this.enqueueMutation(async () => {
			const receipt = await this.loadReceipt();
			if (!receipt || receipt.status === 'finalized' || finalizedVersion < TABLE_PRESET_FILE_MIGRATION_FINALIZED_VERSION) {
				return receipt;
			}
			for (const entry of receipt.cleanupManifest) {
				if (await this.app.vault.adapter.exists(entry.path)) return receipt;
			}
			const finalized: TablePresetFileMigrationReceiptV1 = {
				...receipt,
				status: 'finalized',
				finalizedAt: receipt.finalizedAt || this.now().toISOString(),
				lastError: undefined,
			};
			await this.writeReceipt(finalized);
			return cloneTablePresetFileMigrationReceipt(finalized);
		});
	}

	async recoverBackup(
		request: TablePresetFileBackupRecoveryRequest,
	): Promise<TablePresetFileBackupRecoveryResult> {
		return this.enqueueMutation(async () => {
			const journal = this.requireCompletedJournal();
			const item = journal.items.find(candidate => candidate.presetId === request.presetId);
			if (!item?.backupPath) throw new Error(`No verified migration backup is recorded for ${request.presetId}.`);
			assertPathInside(item.backupPath, journal.backupFolder, 'backup');

			const source = await this.readRequiredFile(item.backupPath);
			const preset = readLegacyTablePresetSidecar(
				source,
				this.storage.getSettings().filterSets.map(filterSet => filterSet.id),
			);
			if (!preset || preset.id !== item.presetId) {
				throw new Error(`Invalid Table preset migration backup: ${item.backupPath}`);
			}
			if (buildTablePresetSemanticSignature(preset) !== item.sourceFingerprint) {
				throw new Error(`Table preset migration backup fingerprint mismatch: ${item.backupPath}`);
			}

			const scan = await this.scanTableFiles();
			const settings = this.storage.getSettings();
			const occupiedIds = new Set([
				...settings.tablePresetOrderIds,
				...settings.tablePresetFileBindings.map(binding => binding.id),
				...scan.valid.map(entry => entry.preset.id),
			]);
			const recoveredPreset: TablePreset = {
				...cloneTablePreset(preset),
				id: this.createUniquePresetId(occupiedIds),
				name: `${preset.name} Recovered`,
			};
			const destination = buildUniqueOperonTableFilePath(
				request.destinationFolder ?? journal.destinationFolder ?? DEFAULT_DESTINATION_FOLDER,
				recoveredPreset.name,
				this.app.vault.getFiles().map(file => file.path),
			);
			const created = await this.createVerifiedTableFile(destination, recoveredPreset);
			try {
				await this.addFileBackedPreset(recoveredPreset.id, destination);
			} catch (error) {
				await this.removeOwnedFile(created, hashContent(serializeOperonTableFile(recoveredPreset)));
				throw error;
			}
			await this.registry.refresh();
			return {
				sourcePresetId: preset.id,
				createdPreset: cloneTablePreset(recoveredPreset),
				path: destination,
				sourceBackupPath: item.backupPath,
				sourceFingerprint: item.sourceFingerprint,
			};
		});
	}

	async resolveDuplicateIdConflict(
		request: TablePresetFileConflictResolutionRequest,
	): Promise<TablePresetFileConflictResolutionResult> {
		return this.enqueueMutation(async () => {
			const presetId = request.presetId.trim();
			const chosenPath = normalizeOperonTableFilePath(request.chosenOriginalPath);
			const scan = await this.scanTableFiles();
			const candidates = scan.valid
				.filter(entry => entry.preset.id === presetId)
				.sort((left, right) => left.path.localeCompare(right.path));
			if (candidates.length < 2) throw new Error(`Table preset ${presetId} does not have a duplicate file conflict.`);
			const chosen = candidates.find(candidate => pathsEqual(candidate.path, chosenPath));
			if (!chosen) throw new Error(`Chosen original is not a valid ${presetId} Table file: ${chosenPath}`);
			if (hashContent(await this.app.vault.read(chosen.file)) !== chosen.fingerprint) {
				throw new Error(`Chosen original changed during conflict review: ${chosen.path}`);
			}

			await this.setOriginalBinding(presetId, chosen.path);
			const succeeded: TablePresetFileConflictResolutionSuccess[] = [];
			const failed: TablePresetFileConflictResolutionFailure[] = [];
			for (const candidate of candidates) {
				if (pathsEqual(candidate.path, chosen.path)) continue;
				try {
					succeeded.push(await this.rewriteConflictFile(candidate, presetId));
				} catch (error) {
					failed.push({ path: candidate.path, error: describeError(error) });
				}
			}
			await this.registry.refresh();
			return { presetId, chosenOriginalPath: chosen.path, succeeded, failed };
		});
	}

	async preflightFinalization(): Promise<TablePresetFileFinalizationPreflightResult> {
		await this.registry.refresh();
		const problems: TablePresetFileLifecycleProblem[] = [];
		const journal = this.storage.tablePresetFileMigrationJournal.get();
		const recoveryRequired = this.storage.tablePresetFileMigrationJournal.getRecoveryRequired();
		if (recoveryRequired) {
			problems.push(problem(
				'migration-recovery-required',
				'Table preset migration journal recovery must be resolved before finalization.',
				[recoveryRequired.backupPath],
			));
		}
		if (!journal) {
			problems.push(problem('journal-unavailable', 'Table preset migration journal is unavailable.', [this.journalPath]));
			return emptyPreflight(problems);
		}
		if (journal.status !== 'completed' || !journal.completedAt
			|| this.storage.getSettings().tablePresetFileMigrationVersion < TABLE_PRESET_FILE_MIGRATION_VERSION) {
			problems.push(problem('migration-not-completed', 'Table preset migration has not completed.', [this.journalPath]));
		}
		for (const item of journal.items) {
			if (item.outcome !== 'backed-up') {
				problems.push(problem(
					'migration-item-incomplete',
					`Table preset migration item ${item.presetId} is not backed up.`,
					item.relatedPaths ?? [],
					item.presetId,
				));
			}
		}

		const scan = await this.scanTableFiles();
		for (const invalid of scan.invalid) {
			problems.push(problem('invalid-table-file', invalid.message, [invalid.path]));
		}
		this.collectBindingProblems(scan, problems);
		const snapshot = this.registry.getSnapshot();
		for (const entry of snapshot.entries.values()) {
			if (entry.status === 'missing') {
				problems.push(problem('registry-missing', `Table preset ${entry.id} is missing.`, compactPaths(entry.source.path), entry.id));
			} else if (entry.status === 'conflict') {
				problems.push(problem(
					'registry-conflict',
					`Table preset ${entry.id} has an unresolved conflict.`,
					entry.conflicts.flatMap(conflict => conflict.paths),
					entry.id,
				));
			}
		}

		const cleanupManifest = await this.buildCleanupManifest(journal, problems);
		const backupFingerprint = cleanupManifest.length > 0 ? hashManifest(cleanupManifest) : null;
		return {
			ok: problems.length === 0,
			runId: journal.runId,
			completedAt: journal.completedAt ?? null,
			presetCount: journal.items.length,
			backupFingerprint,
			cleanupManifest,
			problems,
		};
	}

	async finalize(options: TablePresetFileFinalizeOptions): Promise<TablePresetFileMigrationReceiptV1> {
		return this.enqueueMutation(async () => {
			const preflight = await this.preflightFinalization();
			if (!preflight.ok || !preflight.runId || !preflight.completedAt || !preflight.backupFingerprint) {
				throw new Error(`Table preset migration cannot be finalized: ${formatProblems(preflight.problems)}`);
			}
			const receipt: TablePresetFileMigrationReceiptV1 = {
				version: TABLE_PRESET_FILE_LIFECYCLE_RECEIPT_VERSION,
				migrationVersion: 1,
				runId: preflight.runId,
				completedAt: preflight.completedAt,
				finalizedAt: '',
				presetCount: preflight.presetCount,
				backupFingerprint: preflight.backupFingerprint,
				backupDisposition: 'permanently-deleted',
				status: 'finalizing',
				cleanupManifest: preflight.cleanupManifest.map(entry => ({ ...entry })),
			};
			await this.writeReceipt(receipt);
			return this.runFinalizationCleanup(receipt, options);
		});
	}

	async retryFinalization(options: TablePresetFileFinalizeOptions): Promise<TablePresetFileMigrationReceiptV1> {
		return this.enqueueMutation(async () => {
			const receipt = await this.loadReceipt();
			if (!receipt) throw new Error('No Table preset migration finalization receipt is available.');
			if (receipt.status === 'finalized') return receipt;
			return this.runFinalizationCleanup(receipt, options);
		});
	}

	private async rewriteConflictFile(
		candidate: ValidTableFile,
		oldPresetId: string,
	): Promise<TablePresetFileConflictResolutionSuccess> {
		const currentSource = await this.app.vault.read(candidate.file);
		if (hashContent(currentSource) !== candidate.fingerprint) {
			throw new Error(`Table file changed during conflict review: ${candidate.path}`);
		}
		const parsed = parseOperonTableFile(currentSource, candidate.path);
		if (parsed.status !== 'valid' || parsed.preset.id !== oldPresetId) {
			throw new Error(`Table file is no longer a valid ${oldPresetId} document: ${candidate.path}`);
		}

		const latestScan = await this.scanTableFiles();
		const settings = this.storage.getSettings();
		const occupiedIds = new Set([
			...settings.tablePresetOrderIds,
			...settings.tablePresetFileBindings.map(binding => binding.id),
			...latestScan.valid.map(entry => entry.preset.id),
		]);
		const preset: TablePreset = {
			...cloneTablePreset(parsed.preset),
			id: this.createUniquePresetId(occupiedIds),
			name: `${parsed.preset.name} ID Conflict`,
		};
		const destination = buildUniqueOperonTableFilePath(
			folderPath(candidate.path),
			preset.name,
			this.app.vault.getFiles().map(file => file.path),
		);
		const serialized = serializeOperonTableFile(preset);
		const targetFingerprint = hashContent(serialized);
		let renamed = false;
		try {
			if (this.app.vault.getAbstractFileByPath(destination)) {
				throw new Error(`Conflict resolution destination became occupied: ${destination}`);
			}
			await this.app.fileManager.renameFile(candidate.file, destination);
			renamed = true;
			await this.app.vault.modify(candidate.file, serialized);
			const verified = parseOperonTableFile(await this.app.vault.read(candidate.file), destination);
			if (verified.status !== 'valid' || verified.preset.id !== preset.id) {
				throw new Error(`Conflict resolution verification failed: ${destination}`);
			}
			await this.addFileBackedPreset(preset.id, destination);
			return {
				sourcePath: candidate.path,
				path: destination,
				oldPresetId,
				preset: cloneTablePreset(preset),
				sourceFingerprint: candidate.fingerprint,
				targetFingerprint,
			};
		} catch (error) {
			if (renamed) await this.rollbackConflictRewrite(candidate.file, candidate.path, currentSource, targetFingerprint);
			throw error;
		}
	}

	private async rollbackConflictRewrite(
		file: TFile,
		originalPath: string,
		originalSource: string,
		targetFingerprint: string,
	): Promise<void> {
		try {
			const currentSource = await this.app.vault.read(file);
			if (hashContent(currentSource) !== targetFingerprint && currentSource !== originalSource) return;
			await this.app.vault.modify(file, originalSource);
			if (!pathsEqual(file.path, originalPath) && !this.app.vault.getAbstractFileByPath(originalPath)) {
				await this.app.fileManager.renameFile(file, originalPath);
			}
		} catch (rollbackError) {
			console.error('Operon: failed to roll back Table preset conflict rewrite', rollbackError);
		}
	}

	private async setOriginalBinding(presetId: string, path: string): Promise<void> {
		const settings = this.storage.getSettings();
		const bindings = settings.tablePresetFileBindings.filter(binding => binding.id !== presetId);
		bindings.push({ id: presetId, path });
		const order = settings.tablePresetOrderIds.includes(presetId)
			? [...settings.tablePresetOrderIds]
			: [...settings.tablePresetOrderIds, presetId];
		await this.storage.updateSettings({ tablePresetFileBindings: bindings, tablePresetOrderIds: order });
	}

	private async addFileBackedPreset(presetId: string, path: string): Promise<void> {
		const settings = this.storage.getSettings();
		const bindings = settings.tablePresetFileBindings.filter(binding => binding.id !== presetId);
		bindings.push({ id: presetId, path });
		const order = settings.tablePresetOrderIds.includes(presetId)
			? [...settings.tablePresetOrderIds]
			: [...settings.tablePresetOrderIds, presetId];
		await this.storage.updateSettings({ tablePresetFileBindings: bindings, tablePresetOrderIds: order });
	}

	private async createVerifiedTableFile(path: string, preset: TablePreset): Promise<TFile> {
		if (this.app.vault.getAbstractFileByPath(path)) throw new Error(`Table file path is occupied: ${path}`);
		await this.ensureVaultFolder(folderPath(path));
		const file = await this.app.vault.create(path, serializeOperonTableFile(preset));
		try {
			const parsed = parseOperonTableFile(await this.app.vault.read(file), path);
			if (parsed.status !== 'valid' || parsed.preset.id !== preset.id) {
				throw new Error(`Created Table file verification failed: ${path}`);
			}
			return file;
		} catch (error) {
			await this.removeOwnedFile(file, hashContent(serializeOperonTableFile(preset)));
			throw error;
		}
	}

	private createUniquePresetId(occupiedIds: ReadonlySet<string>): string {
		for (let attempt = 0; attempt < 1000; attempt += 1) {
			const id = this.createPresetId();
			if (isSafeTablePresetId(id) && !occupiedIds.has(id)) return id;
		}
		throw new Error('Could not generate a unique Table preset ID.');
	}

	private async scanTableFiles(): Promise<TableFileScan> {
		const valid: ValidTableFile[] = [];
		const invalid: Array<{ path: string; message: string }> = [];
		for (const file of this.app.vault.getFiles().filter(candidate => isOperonTableFilePath(candidate.path))) {
			let source: string;
			try {
				source = await this.app.vault.read(file);
			} catch (error) {
				invalid.push({ path: file.path, message: `Could not read Table file ${file.path}: ${describeError(error)}` });
				continue;
			}
			const parsed = parseOperonTableFile(source, file.path);
			if (parsed.status !== 'valid') {
				invalid.push({
					path: file.path,
					message: parsed.diagnostics.map(diagnostic => diagnostic.message).join(' '),
				});
				continue;
			}
			valid.push({
				file,
				path: normalizeOperonTableFilePath(file.path),
				preset: parsed.preset,
				source,
				fingerprint: hashContent(source),
			});
		}
		return { valid, invalid };
	}

	private collectBindingProblems(scan: TableFileScan, problems: TablePresetFileLifecycleProblem[]): void {
		const bindings = this.storage.getSettings().tablePresetFileBindings
			.map(binding => ({ id: binding.id, path: normalizeOperonTableFilePath(binding.path) }));
		const bindingsById = groupBindings(bindings, binding => binding.id);
		const bindingsByPath = groupBindings(bindings, binding => getOperonTableFilePathKey(binding.path));
		const filesByPath = new Map(scan.valid.map(file => [getOperonTableFilePathKey(file.path), file]));
		const invalidPathKeys = new Set(scan.invalid.map(file => getOperonTableFilePathKey(file.path)));
		const filesById = groupValidFiles(scan.valid);
		const boundPathKeys = new Set(bindings.map(binding => getOperonTableFilePathKey(binding.path)));
		for (const [id, matches] of bindingsById) {
			if (matches.length > 1) problems.push(problem('duplicate-binding-id', `Binding ID ${id} is duplicated.`, matches.map(item => item.path), id));
		}
		for (const matches of bindingsByPath.values()) {
			if (matches.length > 1) problems.push(problem('duplicate-binding-path', `Binding path ${matches[0].path} is duplicated.`, [matches[0].path]));
		}
		for (const binding of bindings) {
			const file = filesByPath.get(getOperonTableFilePathKey(binding.path));
			if (!file) {
				const invalid = invalidPathKeys.has(getOperonTableFilePathKey(binding.path));
				problems.push(problem(
					invalid ? 'invalid-binding-file' : 'missing-binding-file',
					invalid ? `Bound Table file is invalid: ${binding.path}` : `Bound Table file is missing: ${binding.path}`,
					[binding.path],
					binding.id,
				));
			} else if (file.preset.id !== binding.id) {
				problems.push(problem('binding-id-mismatch', `Bound Table file ID differs at ${binding.path}.`, [binding.path], binding.id));
			}
		}
		for (const [id, files] of filesById) {
			if (files.length > 1) problems.push(problem('duplicate-table-file-id', `Table preset ID ${id} is duplicated.`, files.map(file => file.path), id));
		}
		for (const file of scan.valid) {
			if (!boundPathKeys.has(getOperonTableFilePathKey(file.path))) {
				problems.push(problem('unbound-table-file', `Table file is not bound in settings: ${file.path}`, [file.path], file.preset.id));
			}
		}
	}

	private async buildCleanupManifest(
		journal: ReturnType<TablePresetFileLifecycle<TDescriptor>['requireCompletedJournal']>,
		problems: TablePresetFileLifecycleProblem[],
	): Promise<TablePresetFileCleanupManifestEntryV1[]> {
		const manifest: TablePresetFileCleanupManifestEntryV1[] = [];
		for (const item of journal.items) {
			if (!item.backupPath) {
				problems.push(problem('backup-missing', `Backup path is missing for ${item.presetId}.`, [], item.presetId));
				continue;
			}
			try {
				assertPathInside(item.backupPath, journal.backupFolder, 'backup');
			} catch (error) {
				problems.push(problem('backup-invalid', describeError(error), [item.backupPath], item.presetId));
				continue;
			}
			const source = await this.readOptionalFile(item.backupPath);
			if (source === null) {
				problems.push(problem('backup-missing', `Backup file is missing: ${item.backupPath}`, [item.backupPath], item.presetId));
				continue;
			}
			const preset = readLegacyTablePresetSidecar(
				source,
				this.storage.getSettings().filterSets.map(filterSet => filterSet.id),
			);
			if (!preset || preset.id !== item.presetId) {
				problems.push(problem('backup-invalid', `Backup is invalid: ${item.backupPath}`, [item.backupPath], item.presetId));
				continue;
			}
			if (buildTablePresetSemanticSignature(preset) !== item.sourceFingerprint) {
				problems.push(problem('backup-fingerprint-mismatch', `Backup fingerprint differs: ${item.backupPath}`, [item.backupPath], item.presetId));
				continue;
			}
			manifest.push({ kind: 'backup-preset', path: item.backupPath, fingerprint: hashContent(source) });
		}

		const indexPath = joinVaultPath(journal.backupFolder, 'index.json');
		const indexSource = await this.readOptionalFile(indexPath);
		if (journal.legacyIndexFingerprint && indexSource === null) {
			problems.push(problem('backup-missing', `Migration index backup is missing: ${indexPath}`, [indexPath]));
		} else if (journal.legacyIndexFingerprint && hashContent(indexSource!) !== journal.legacyIndexFingerprint) {
			problems.push(problem('backup-fingerprint-mismatch', `Migration index backup differs: ${indexPath}`, [indexPath]));
		} else if (indexSource !== null) {
			manifest.push({ kind: 'backup-index', path: indexPath, fingerprint: hashContent(indexSource) });
		}

		const journalSource = await this.readOptionalFile(this.journalPath);
		if (journalSource === null) {
			problems.push(problem('journal-unavailable', `Migration journal file is missing: ${this.journalPath}`, [this.journalPath]));
		} else {
			manifest.push({ kind: 'migration-journal', path: this.journalPath, fingerprint: hashContent(journalSource) });
		}
		const duplicatePaths = findDuplicateManifestPaths(manifest);
		for (const path of duplicatePaths) {
			problems.push(problem('backup-invalid', `Cleanup manifest path is recorded more than once: ${path}`, [path]));
		}
		return dedupeManifest(manifest);
	}

	private async runFinalizationCleanup(
		receipt: TablePresetFileMigrationReceiptV1,
		options: TablePresetFileFinalizeOptions,
	): Promise<TablePresetFileMigrationReceiptV1> {
		this.validateCleanupManifestSafety(receipt);
		const working: TablePresetFileMigrationReceiptV1 = {
			...cloneTablePresetFileMigrationReceipt(receipt),
			status: 'finalizing',
			lastError: undefined,
		};
		await this.writeReceipt(working);
		try {
			for (const entry of working.cleanupManifest) await this.removeManifestEntry(entry);
			await options.commitFinalizedVersion(TABLE_PRESET_FILE_MIGRATION_FINALIZED_VERSION);
			const finalized: TablePresetFileMigrationReceiptV1 = {
				...working,
				status: 'finalized',
				finalizedAt: this.now().toISOString(),
			};
			await this.writeReceipt(finalized);
			await this.removeEmptyBackupFolders(working.cleanupManifest);
			return cloneTablePresetFileMigrationReceipt(finalized);
		} catch (error) {
			const failed: TablePresetFileMigrationReceiptV1 = {
				...working,
				status: 'cleanup-failed',
				lastError: describeError(error),
			};
			await this.writeReceipt(failed);
			return cloneTablePresetFileMigrationReceipt(failed);
		}
	}

	private async removeManifestEntry(entry: TablePresetFileCleanupManifestEntryV1): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(entry.path))) return;
		const source = await adapter.read(entry.path);
		if (hashContent(source) !== entry.fingerprint) {
			throw new Error(`Finalization cleanup file changed after preflight: ${entry.path}`);
		}
		await adapter.remove(entry.path);
		if (await adapter.exists(entry.path)) throw new Error(`Finalization cleanup could not remove: ${entry.path}`);
	}

	private async removeEmptyBackupFolders(manifest: readonly TablePresetFileCleanupManifestEntryV1[]): Promise<void> {
		const backupPaths = manifest.filter(entry => entry.kind !== 'migration-journal').map(entry => entry.path);
		if (backupPaths.length === 0) return;
		const folder = folderPath(backupPaths[0]);
		if (!folder || !backupPaths.every(path => pathsEqual(folderPath(path), folder))) return;
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(folder))) return;
		const listed = await adapter.list(folder);
		if (listed.files.length === 0 && listed.folders.length === 0) await adapter.rmdir(folder, false);
	}

	private async writeReceipt(receipt: TablePresetFileMigrationReceiptV1): Promise<void> {
		await ensureAdapterFolder(this.app, folderPath(this.receiptPath));
		await writeJsonSafely(this.app.vault.adapter, this.receiptPath, receipt);
	}

	private validateCleanupManifestSafety(receipt: TablePresetFileMigrationReceiptV1): void {
		if (hashManifest(receipt.cleanupManifest) !== receipt.backupFingerprint) {
			throw new Error('Table preset finalization receipt manifest fingerprint is invalid.');
		}
		for (const entry of receipt.cleanupManifest) {
			if (entry.kind === 'migration-journal') {
				if (!pathsEqual(entry.path, this.journalPath)) {
					throw new Error(`Finalization receipt contains an unexpected migration journal path: ${entry.path}`);
				}
			} else if (!isPathInside(entry.path, this.storage.tablePresetFileMigrationBackupRootPath)) {
				throw new Error(`Finalization receipt contains a path outside the migration backup root: ${entry.path}`);
			}
		}
	}

	private async ensureVaultFolder(path: string): Promise<void> {
		if (!path) return;
		let current = '';
		for (const segment of normalizeOperonTableFilePath(path).split('/').filter(Boolean)) {
			current = current ? `${current}/${segment}` : segment;
			if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
		}
	}

	private requireCompletedJournal() {
		const journal = this.storage.tablePresetFileMigrationJournal.get();
		if (!journal || journal.status !== 'completed' || !journal.completedAt) {
			throw new Error('Table preset file migration is not completed.');
		}
		if (this.storage.tablePresetFileMigrationJournal.getRecoveryRequired()) {
			throw new Error('Table preset file migration journal recovery is required.');
		}
		return journal;
	}

	private async readRequiredFile(path: string): Promise<string> {
		const source = await this.readOptionalFile(path);
		if (source === null) throw new Error(`Required file is missing: ${path}`);
		return source;
	}

	private async readOptionalFile(path: string): Promise<string | null> {
		const adapter = this.app.vault.adapter;
		return await adapter.exists(path) ? adapter.read(path) : null;
	}

	private async removeOwnedFile(file: TFile, expectedFingerprint: string): Promise<void> {
		try {
			if (hashContent(await this.app.vault.read(file)) === expectedFingerprint) {
				await this.app.fileManager.trashFile(file);
			}
		} catch (error) {
			console.error('Operon: failed to clean up lifecycle-owned Table file', error);
		}
	}

	private async enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.mutationQueue.then(operation);
		this.mutationQueue = run.then(() => undefined, () => undefined);
		return run;
	}
}

function derivePluginStateFolder(backupRootPath: string): string {
	const normalized = normalizeOperonTableFilePath(backupRootPath);
	const marker = '/data/migrations/table-presets-v1';
	const markerIndex = normalized.toLocaleLowerCase('en-US').lastIndexOf(marker);
	if (markerIndex < 0) throw new Error('Cannot derive Operon state folder from Table migration backup root.');
	return `${normalized.slice(0, markerIndex)}/state`;
}

function folderPath(path: string): string {
	const normalized = normalizeOperonTableFilePath(path);
	const slash = normalized.lastIndexOf('/');
	return slash < 0 ? '' : normalized.slice(0, slash);
}

function pathsEqual(left: string, right: string): boolean {
	return getOperonTableFilePathKey(left) === getOperonTableFilePathKey(right);
}

function hashContent(source: string): string {
	let hash = 2166136261;
	for (let index = 0; index < source.length; index += 1) {
		hash ^= source.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16);
}

function hashManifest(entries: readonly TablePresetFileCleanupManifestEntryV1[]): string {
	return hashContent(entries
		.map(entry => `${entry.kind}\u0000${normalizeOperonTableFilePath(entry.path)}\u0000${entry.fingerprint}`)
		.sort()
		.join('\u0001'));
}

function assertPathInside(path: string, folder: string, label: string): void {
	if (!isPathInside(path, folder)) {
		throw new Error(`Recorded ${label} path is outside its migration folder: ${path}`);
	}
}

function isPathInside(path: string, folder: string): boolean {
	const normalizedPath = normalizeOperonTableFilePath(path);
	const normalizedFolder = normalizeOperonTableFilePath(folder);
	const prefix = `${getOperonTableFilePathKey(normalizedFolder)}/`;
	return getOperonTableFilePathKey(normalizedPath).startsWith(prefix);
}

function groupBindings(
	bindings: readonly TablePresetFileBinding[],
	keyOf: (binding: TablePresetFileBinding) => string,
): Map<string, TablePresetFileBinding[]> {
	const grouped = new Map<string, TablePresetFileBinding[]>();
	for (const binding of bindings) grouped.set(keyOf(binding), [...(grouped.get(keyOf(binding)) ?? []), binding]);
	return grouped;
}

function groupValidFiles(files: readonly ValidTableFile[]): Map<string, ValidTableFile[]> {
	const grouped = new Map<string, ValidTableFile[]>();
	for (const file of files) grouped.set(file.preset.id, [...(grouped.get(file.preset.id) ?? []), file]);
	return grouped;
}

function problem(
	code: TablePresetFileLifecycleProblemCode,
	message: string,
	paths: string[],
	presetId?: string,
): TablePresetFileLifecycleProblem {
	return { code, message, paths: [...new Set(paths.map(normalizeOperonTableFilePath))], ...(presetId ? { presetId } : {}) };
}

function compactPaths(path: string | null): string[] {
	return path ? [path] : [];
}

function emptyPreflight(problems: TablePresetFileLifecycleProblem[]): TablePresetFileFinalizationPreflightResult {
	return {
		ok: false,
		runId: null,
		completedAt: null,
		presetCount: 0,
		backupFingerprint: null,
		cleanupManifest: [],
		problems,
	};
}

function dedupeManifest(
	entries: readonly TablePresetFileCleanupManifestEntryV1[],
): TablePresetFileCleanupManifestEntryV1[] {
	const seen = new Set<string>();
	return entries.filter(entry => {
		const key = getOperonTableFilePathKey(entry.path);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	}).map(entry => ({ ...entry }));
}

function findDuplicateManifestPaths(entries: readonly TablePresetFileCleanupManifestEntryV1[]): string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const entry of entries) {
		const key = getOperonTableFilePathKey(entry.path);
		if (seen.has(key)) duplicates.add(entry.path);
		seen.add(key);
	}
	return [...duplicates];
}

function formatProblems(problems: readonly TablePresetFileLifecycleProblem[]): string {
	return problems.map(item => item.message).join(' ');
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function ensureAdapterFolder(app: App, path: string): Promise<void> {
	if (!path) return;
	const adapter = app.vault.adapter;
	let current = '';
	for (const segment of normalizeOperonTableFilePath(path).split('/').filter(Boolean)) {
		current = current ? `${current}/${segment}` : segment;
		if (!(await adapter.exists(current))) await adapter.mkdir(current);
	}
}
