import { App, TFile } from 'obsidian';
import { normalizeTablePreset, type TablePreset, type TablePresetFileBinding } from '../types/table';
import type {
	TablePresetFileMigrationJournalItemV1,
	TablePresetFileMigrationJournalV1,
	TablePresetFileMigrationStatus,
} from '../types/table-preset-file-migration';
import type { OperonStorage } from './operon-storage';
import {
	buildTablePresetSemanticSignature,
	preflightTablePresetFileMigration,
	type TablePresetFileMigrationBlockCode,
} from './table-preset-file-migration';
import {
	discoverOperonTableFiles,
	getOperonTableFilePathKey,
	parseOperonTableFile,
	serializeOperonTableFile,
} from './table-file';
import { joinVaultPath } from './operon-storage-paths';

export const TABLE_PRESET_FILE_MIGRATION_VERSION = 1;
export const TABLE_PRESET_FILE_MIGRATION_DESTINATION = 'Operon/Tables';

export interface TablePresetFileMigrationSummary {
	status: TablePresetFileMigrationStatus;
	total: number;
	migrated: number;
	adopted: number;
	alreadyMigrated: number;
	blocked: number;
	failed: number;
	backupFolder: string | null;
	journal: TablePresetFileMigrationJournalV1 | null;
}

export interface TablePresetFileMigrationRunOptions {
	destinationFolder?: string;
	now?: () => Date;
	runId?: string;
}

export async function runTablePresetFileMigration(
	app: App,
	storage: OperonStorage,
	options: TablePresetFileMigrationRunOptions = {},
): Promise<TablePresetFileMigrationSummary> {
	const settings = storage.getSettings();
	const journalStore = storage.tablePresetFileMigrationJournal;
	const existingJournal = journalStore.get();
	const now = options.now ?? (() => new Date());
	if (settings.tablePresetFileMigrationVersion >= TABLE_PRESET_FILE_MIGRATION_VERSION) {
		let completedJournal = existingJournal;
		if (existingJournal && (existingJournal.status !== 'completed' || !existingJournal.completedAt)) {
			if (!existingJournal.items.every(item => item.outcome === 'backed-up')) {
				return summarizeTablePresetFileMigrationJournal(existingJournal, 'failed');
			}
			const timestamp = now().toISOString();
			completedJournal = {
				...existingJournal,
				status: 'completed',
				completedAt: existingJournal.completedAt ?? timestamp,
				updatedAt: timestamp,
				lastError: undefined,
			};
			try {
				await journalStore.replace(completedJournal);
			} catch (error) {
				console.error('Operon: failed to reconcile completed Table file migration journal', error);
				return summarizeTablePresetFileMigrationJournal(existingJournal, 'failed');
			}
		}
		const boundPresetIds = new Set(settings.tablePresetFileBindings.map(binding => binding.id));
		if (storage.tablePresets.getAll().tablePresets.some(preset => boundPresetIds.has(preset.id))) {
			await storage.saveSettings();
		}
		return summarizeTablePresetFileMigrationJournal(completedJournal, 'completed');
	}
	if (!journalStore.canPersist()) {
		return summarizeTablePresetFileMigrationJournal(existingJournal, 'failed');
	}

	const timestamp = now().toISOString();
	const runId = existingJournal?.runId ?? options.runId ?? buildRunId(now);
	const destinationFolder = options.destinationFolder ?? TABLE_PRESET_FILE_MIGRATION_DESTINATION;
	const backupFolder = existingJournal?.backupFolder
		?? joinVaultPath(storage.tablePresetFileMigrationBackupRootPath, runId);
	const legacyPresetsFromStore = await loadLegacyPresetsForMigration(app, storage);
	const legacyPresets = legacyPresetsFromStore.filter(preset =>
		!settings.tablePresetFileBindings.some(binding => binding.id === preset.id)
	);
	const descriptors = app.vault.getFiles();
	const sourceByPath = new Map<string, string>();
	const discovery = await discoverOperonTableFiles(descriptors, async descriptor => {
		const source = await app.vault.read(descriptor);
		sourceByPath.set(descriptor.path, source);
		return source;
	});
	const invalidFileIdClaims = discovery.files.flatMap(file => {
		if (file.status === 'loaded') return [];
		const source = sourceByPath.get(file.descriptor.path);
		const id = source ? readLooseTableFileId(source) : null;
		return id ? [{ id, path: file.path }] : [];
	});
	const priorJournalItems = existingJournal?.items.flatMap(item =>
		item.targetPath ? [{
			id: item.presetId,
			path: item.targetPath,
			semanticSignature: item.sourceFingerprint,
		}] : []
	) ?? [];
	const preflight = preflightTablePresetFileMigration({
		legacyPresets,
		existingBindings: settings.tablePresetFileBindings,
		discoveredFiles: discovery.files,
		existingPaths: descriptors.map(file => file.path),
		destinationFolder,
		priorJournalItems,
		invalidFileIdClaims,
	});
	const plannedItems = preflight.items.map(item => ({
		preset: item.legacyPreset,
		classification: item.status,
		targetPath: item.targetPath,
		blockCodes: item.blockCodes,
	}));
	plannedItems.push(...await buildBoundSidecarPlans(app, storage, discovery.files, legacyPresets));

	let journal = buildJournal(
		existingJournal,
		runId,
		destinationFolder,
		backupFolder,
		plannedItems,
		storage,
		timestamp,
	);
	journal.status = 'running';
	journal.updatedAt = timestamp;
	try {
		await journalStore.replace(journal);
		await ensureFolder(app, backupFolder);
		const legacyIndexFingerprint = await backupIndexSnapshot(
			app,
			storage.tablePresets.getIndexPath(),
			joinVaultPath(backupFolder, 'index.json'),
			journal.legacyIndexFingerprint,
		);
		if (legacyIndexFingerprint && legacyIndexFingerprint !== journal.legacyIndexFingerprint) {
			journal.legacyIndexFingerprint = legacyIndexFingerprint;
			journal.updatedAt = now().toISOString();
			await journalStore.replace(journal);
		}
	} catch (error) {
		return await failMigrationBeforeItems(journalStore, journal, error, now);
	}

	let fatalError: string | null = null;
	for (const item of journal.items) {
		if (item.classification === 'blocked') continue;
		try {
			journal = await processMigrationItem(app, storage, journal, item.presetId, now);
		} catch (error) {
			fatalError = error instanceof Error ? error.message : String(error);
			journal = updateJournalItem(journal, item.presetId, current => ({
				...current,
				outcome: 'failed',
				attemptCount: current.attemptCount + 1,
				updatedAt: now().toISOString(),
				error: fatalError ?? 'Migration failed',
			}));
			journal.status = 'failed';
			journal.lastError = fatalError;
			journal.updatedAt = now().toISOString();
			try {
				await journalStore.replace(journal);
			} catch (persistError) {
				console.error('Operon: failed to persist interrupted Table file migration state', persistError);
			}
			break;
		}
	}

	if (!fatalError) {
		const hasBlocked = journal.items.some(item => item.outcome === 'blocked' || item.outcome === 'failed');
		if (!hasBlocked) {
			try {
				await storage.commitTablePresetFileMigrationVersion(TABLE_PRESET_FILE_MIGRATION_VERSION);
				journal.status = 'completed';
				journal.completedAt = now().toISOString();
			} catch (error) {
				journal.status = 'failed';
				journal.lastError = error instanceof Error ? error.message : String(error);
			}
		} else {
			journal.status = 'partial';
		}
		journal.updatedAt = now().toISOString();
		if (journal.status !== 'failed') journal.lastError = undefined;
		try {
			await journalStore.replace(journal);
		} catch (error) {
			console.error('Operon: failed to persist final Table file migration state', error);
			journal.status = 'failed';
			journal.lastError = error instanceof Error ? error.message : String(error);
		}
	}

	return summarizeTablePresetFileMigrationJournal(journal);
}

async function processMigrationItem(
	app: App,
	storage: OperonStorage,
	journal: TablePresetFileMigrationJournalV1,
	presetId: string,
	now: () => Date,
): Promise<TablePresetFileMigrationJournalV1> {
	const item = journal.items.find(candidate => candidate.presetId === presetId);
	if (!item || item.classification === 'blocked' || !item.targetPath) return journal;
	if (item.outcome === 'backed-up') return journal;
	const legacyPreset = storage.tablePresets.getAll().tablePresets.find(preset => preset.id === presetId);
	const existingFile = app.vault.getAbstractFileByPath(item.targetPath);
	let targetFile = existingFile instanceof TFile ? existingFile : null;
	let targetPreset = targetFile ? readValidTargetPreset(await app.vault.read(targetFile), targetFile.path, presetId) : null;

	if (!targetPreset && item.classification === 'create') {
		if (!legacyPreset) throw new Error(`Legacy Table preset is unavailable: ${presetId}`);
		const serialized = serializeOperonTableFile(legacyPreset);
		const expectedFingerprint = hashContent(serialized);
		const stagedPath = item.stagedPath ?? buildStagedPath(item.targetPath, journal.runId);
		const existingStagedFile = app.vault.getAbstractFileByPath(stagedPath);
		let stagedFile: TFile;
		if (existingStagedFile instanceof TFile) {
			stagedFile = existingStagedFile;
			const stagedSource = await app.vault.read(stagedFile);
			if (hashContent(stagedSource) !== expectedFingerprint) {
				throw new Error(`Migration staging file changed externally: ${stagedPath}`);
			}
		} else if (existingStagedFile) {
			throw new Error(`Migration staging path is occupied: ${stagedPath}`);
		} else {
			stagedFile = await app.vault.create(stagedPath, serialized);
		}
		journal = updateJournalItem(journal, presetId, current => ({
			...current,
			outcome: 'staged',
			stagedPath,
			targetFingerprint: expectedFingerprint,
			attemptCount: current.attemptCount + 1,
			updatedAt: now().toISOString(),
			error: undefined,
		}));
		journal.updatedAt = now().toISOString();
		await storage.tablePresetFileMigrationJournal.replace(journal);
		readValidTargetPreset(await app.vault.read(stagedFile), stagedPath, presetId);
		if (app.vault.getAbstractFileByPath(item.targetPath)) {
			throw new Error(`Table migration target became occupied: ${item.targetPath}`);
		}
		await app.fileManager.renameFile(stagedFile, item.targetPath);
		targetFile = stagedFile;
		targetPreset = readValidTargetPreset(await app.vault.read(targetFile), targetFile.path, presetId);
	}

	if (!targetFile || !targetPreset) throw new Error(`Table migration target is unavailable: ${item.targetPath}`);
	if (legacyPreset && buildTablePresetSemanticSignature(legacyPreset) !== buildTablePresetSemanticSignature(targetPreset)) {
		throw new Error(`Table migration target content changed: ${item.targetPath}`);
	}

	try {
		await storage.commitTablePresetFileBinding(presetId, targetFile.path);
	} catch (error) {
		if (item.classification === 'create' && item.targetFingerprint) {
			await removeOwnedMigrationFile(app, targetFile, item.targetFingerprint);
		}
		throw error;
	}

	journal = updateJournalItem(journal, presetId, current => ({
		...current,
		outcome: current.classification === 'create' ? 'migrated' : 'adopted',
		targetPath: targetFile.path,
		stagedPath: undefined,
		updatedAt: now().toISOString(),
		error: undefined,
	}));
	journal.updatedAt = now().toISOString();
	await storage.tablePresetFileMigrationJournal.replace(journal);

	const plannedBackupPath = buildLegacyPresetBackupPath(storage, presetId, journal.backupFolder);
	journal = updateJournalItem(journal, presetId, current => ({
		...current,
		backupPath: plannedBackupPath,
		updatedAt: now().toISOString(),
	}));
	journal.updatedAt = now().toISOString();
	await storage.tablePresetFileMigrationJournal.replace(journal);
	const backupPath = await backupLegacyPresetSidecar(
		app,
		storage,
		presetId,
		journal.backupFolder,
		item.sourceFingerprint,
	);
	if (!backupPath) throw new Error(`Table preset backup is unavailable: ${plannedBackupPath}`);
	journal = updateJournalItem(journal, presetId, current => ({
		...current,
		outcome: 'backed-up',
		backupPath: backupPath ?? current.backupPath,
		updatedAt: now().toISOString(),
	}));
	journal.updatedAt = now().toISOString();
	await storage.tablePresetFileMigrationJournal.replace(journal);
	return journal;
}

function buildJournal(
	existing: TablePresetFileMigrationJournalV1 | null,
	runId: string,
	destinationFolder: string,
	backupFolder: string,
	planned: Array<{
		preset: TablePreset;
		classification: 'create' | 'adopt' | 'blocked' | 'already-migrated';
		targetPath: string | null;
		blockCodes: TablePresetFileMigrationBlockCode[];
	}>,
	storage: OperonStorage,
	timestamp: string,
): TablePresetFileMigrationJournalV1 {
	const previousById = new Map(existing?.items.map(item => [item.presetId, item]) ?? []);
	const items: TablePresetFileMigrationJournalItemV1[] = planned.map(plan => {
		const previous = previousById.get(plan.preset.id);
		const semanticSignature = buildTablePresetSemanticSignature(plan.preset);
		const targetFingerprint = hashContent(serializeOperonTableFile(plan.preset));
		const canResume = previous?.sourceFingerprint === semanticSignature
			&& previous.targetPath === plan.targetPath;
		const resumableItem = canResume ? previous : undefined;
		return {
			...(canResume ? previous : {}),
			presetId: plan.preset.id,
			presetName: plan.preset.name,
			legacyPath: storage.tablePresets.getPresetFilePath(plan.preset.id),
			targetPath: plan.targetPath,
			sourceFingerprint: semanticSignature,
			targetFingerprint,
			classification: plan.classification,
			outcome: plan.classification === 'blocked' ? 'blocked' : resumableItem?.outcome ?? 'pending',
			attemptCount: resumableItem?.attemptCount ?? 0,
			updatedAt: timestamp,
			relatedPaths: plan.targetPath ? [plan.targetPath] : [],
			error: plan.blockCodes.length > 0 ? plan.blockCodes.join(', ') : resumableItem?.error,
		} satisfies TablePresetFileMigrationJournalItemV1;
	});
	for (const previous of existing?.items ?? []) {
		if (!items.some(item => item.presetId === previous.presetId)) items.push({ ...previous });
	}
	return {
		version: 1,
		runId,
		status: existing?.status ?? 'pending',
		destinationFolder,
		backupFolder,
		legacyIndexFingerprint: existing?.legacyIndexFingerprint,
		items,
		startedAt: existing?.startedAt ?? timestamp,
		updatedAt: timestamp,
		completedAt: existing?.completedAt,
		lastError: existing?.lastError,
	};
}

async function buildBoundSidecarPlans(
	app: App,
	storage: OperonStorage,
	discoveredFiles: Awaited<ReturnType<typeof discoverOperonTableFiles>>['files'],
	activeLegacyPresets: readonly TablePreset[],
): Promise<Array<{
	preset: TablePreset;
	classification: 'already-migrated' | 'blocked';
	targetPath: string | null;
	blockCodes: TablePresetFileMigrationBlockCode[];
}>> {
	const adapter = app.vault.adapter;
	const activeLegacyIds = new Set(activeLegacyPresets.map(preset => preset.id));
	const availableFilterSetIds = storage.getSettings().filterSets.map(filterSet => filterSet.id);
	const result: Array<{
		preset: TablePreset;
		classification: 'already-migrated' | 'blocked';
		targetPath: string | null;
		blockCodes: TablePresetFileMigrationBlockCode[];
	}> = [];
	for (const binding of storage.getSettings().tablePresetFileBindings) {
		if (activeLegacyIds.has(binding.id)) continue;
		const sidecarPath = storage.tablePresets.getPresetFilePath(binding.id);
		if (!(await adapter.exists(sidecarPath))) continue;
		const file = discoveredFiles.find(candidate => pathsEqual(candidate.path, binding.path));
		const filePreset = file?.status === 'loaded' && file.preset?.id === binding.id ? file.preset : null;
		const sidecarPreset = readLegacyTablePresetSidecar(await adapter.read(sidecarPath), availableFilterSetIds);
		const preset = filePreset ?? sidecarPreset;
		if (!preset) continue;
		const equivalent = !!filePreset && !!sidecarPreset
			&& buildTablePresetSemanticSignature(filePreset) === buildTablePresetSemanticSignature(sidecarPreset);
		result.push({
			preset,
			classification: equivalent ? 'already-migrated' : 'blocked',
			targetPath: binding.path,
			blockCodes: equivalent ? [] : ['target-content-mismatch'],
		});
	}
	return result;
}

async function backupIndexSnapshot(
	app: App,
	sourcePath: string,
	backupPath: string,
	expectedFingerprint?: string,
): Promise<string | null> {
	const adapter = app.vault.adapter;
	const sourceExists = await adapter.exists(sourcePath);
	const source = sourceExists ? await adapter.read(sourcePath) : null;
	if (await adapter.exists(backupPath)) {
		const backup = await adapter.read(backupPath);
		const backupFingerprint = hashContent(backup);
		if (expectedFingerprint && backupFingerprint !== expectedFingerprint) {
			throw new Error(`Table migration index backup fingerprint differs: ${backupPath}`);
		}
		if (!expectedFingerprint && source !== null && backup !== source) {
			throw new Error(`Table migration index backup differs: ${backupPath}`);
		}
		return backupFingerprint;
	}
	if (source === null) return null;
	await adapter.write(backupPath, source);
	if (await adapter.read(backupPath) !== source) throw new Error(`Table migration index backup verification failed: ${backupPath}`);
	return hashContent(source);
}

async function failMigrationBeforeItems(
	journalStore: OperonStorage['tablePresetFileMigrationJournal'],
	journal: TablePresetFileMigrationJournalV1,
	error: unknown,
	now: () => Date,
): Promise<TablePresetFileMigrationSummary> {
	journal.status = 'failed';
	journal.updatedAt = now().toISOString();
	journal.lastError = error instanceof Error ? error.message : String(error);
	try {
		await journalStore.replace(journal);
	} catch (persistError) {
		console.error('Operon: failed to persist Table file migration failure state', persistError);
	}
	return summarizeTablePresetFileMigrationJournal(journal);
}

async function backupLegacyPresetSidecar(
	app: App,
	storage: OperonStorage,
	presetId: string,
	backupFolder: string,
	expectedFingerprint: string,
): Promise<string | null> {
	const adapter = app.vault.adapter;
	const sourcePath = storage.tablePresets.getPresetFilePath(presetId);
	const backupPath = buildLegacyPresetBackupPath(storage, presetId, backupFolder);
	if (!(await adapter.exists(sourcePath))) {
		if (!(await adapter.exists(backupPath))) return null;
		const backupPreset = readLegacyTablePresetSidecar(
			await adapter.read(backupPath),
			storage.getSettings().filterSets.map(filterSet => filterSet.id),
		);
		return backupPreset && backupPreset.id === presetId
			&& buildTablePresetSemanticSignature(backupPreset) === expectedFingerprint
			? backupPath
			: null;
	}
	const source = await adapter.read(sourcePath);
	if (await adapter.exists(backupPath)) {
		if (await adapter.read(backupPath) !== source) throw new Error(`Table preset backup differs: ${backupPath}`);
	} else {
		await adapter.write(backupPath, source);
	}
	if (await adapter.read(backupPath) !== source) throw new Error(`Table preset backup verification failed: ${backupPath}`);
	await adapter.remove(sourcePath);
	return backupPath;
}

function buildLegacyPresetBackupPath(storage: OperonStorage, presetId: string, backupFolder: string): string {
	const sourcePath = storage.tablePresets.getPresetFilePath(presetId);
	return joinVaultPath(backupFolder, sourcePath.slice(sourcePath.lastIndexOf('/') + 1));
}

async function ensureFolder(app: App, path: string): Promise<void> {
	const adapter = app.vault.adapter;
	let current = '';
	for (const segment of path.split('/').filter(Boolean)) {
		current = current ? `${current}/${segment}` : segment;
		if (!(await adapter.exists(current))) await adapter.mkdir(current);
	}
}

function buildStagedPath(targetPath: string, runId: string): string {
	return `${targetPath}.migrating-${runId}`;
}

async function removeOwnedMigrationFile(app: App, file: TFile, expectedFingerprint: string): Promise<void> {
	if (hashContent(await app.vault.read(file)) !== expectedFingerprint) return;
	await app.fileManager.trashFile(file);
}

function readValidTargetPreset(source: string, path: string, expectedId: string): TablePreset {
	const parsed = parseOperonTableFile(source, path);
	if (parsed.status !== 'valid' || parsed.preset.id !== expectedId) {
		throw new Error(`Table migration verification failed: ${path}`);
	}
	return parsed.preset;
}

function readLooseTableFileId(source: string): string | null {
	try {
		const value = JSON.parse(source) as unknown;
		if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
		const id = (value as Record<string, unknown>).id;
		return typeof id === 'string' && id.trim() ? id.trim() : null;
	} catch {
		return null;
	}
}

function updateJournalItem(
	journal: TablePresetFileMigrationJournalV1,
	presetId: string,
	update: (item: TablePresetFileMigrationJournalItemV1) => TablePresetFileMigrationJournalItemV1,
): TablePresetFileMigrationJournalV1 {
	return {
		...journal,
		items: journal.items.map(item => item.presetId === presetId ? update(item) : { ...item }),
	};
}

export function summarizeTablePresetFileMigrationJournal(
	journal: TablePresetFileMigrationJournalV1 | null,
	statusOverride?: TablePresetFileMigrationStatus,
): TablePresetFileMigrationSummary {
	const items = journal?.items ?? [];
	return {
		status: statusOverride ?? journal?.status ?? 'pending',
		total: items.length,
		migrated: items.filter(item => item.classification === 'create' && item.outcome === 'backed-up').length,
		adopted: items.filter(item => item.classification === 'adopt' && item.outcome === 'backed-up').length,
		alreadyMigrated: items.filter(item => item.classification === 'already-migrated' && item.outcome === 'backed-up').length,
		blocked: items.filter(item => item.outcome === 'blocked').length,
		failed: items.filter(item => item.outcome === 'failed').length,
		backupFolder: journal?.backupFolder ?? null,
		journal,
	};
}

function buildRunId(now: () => Date): string {
	return `table-files-${now().toISOString().replace(/[^0-9]/gu, '').slice(0, 14)}`;
}

function hashContent(source: string): string {
	let hash = 2166136261;
	for (let index = 0; index < source.length; index++) {
		hash ^= source.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16);
}

export function readLegacyTablePresetSidecar(
	source: string,
	availableFilterSetIds: readonly string[],
): TablePreset | null {
	try {
		const value = JSON.parse(source) as unknown;
		if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
		const record = { ...(value as Record<string, unknown>) };
		delete record.version;
		const requestedFilterSetId = typeof record.filterSetId === 'string' && record.filterSetId.trim()
			? record.filterSetId.trim()
			: null;
		const normalizationFilterIds = requestedFilterSetId && !availableFilterSetIds.includes(requestedFilterSetId)
			? [...availableFilterSetIds, requestedFilterSetId]
			: availableFilterSetIds;
		return normalizeTablePreset(record, { availableFilterSetIds: normalizationFilterIds });
	} catch {
		return null;
	}
}

async function loadLegacyPresetsForMigration(app: App, storage: OperonStorage): Promise<TablePreset[]> {
	const availableFilterSetIds = storage.getSettings().filterSets.map(filterSet => filterSet.id);
	const presets: TablePreset[] = [];
	for (const runtimePreset of storage.tablePresets.getAll().tablePresets) {
		const path = storage.tablePresets.getPresetFilePath(runtimePreset.id);
		if (!(await app.vault.adapter.exists(path))) {
			presets.push(runtimePreset);
			continue;
		}
		const sidecarPreset = readLegacyTablePresetSidecar(
			await app.vault.adapter.read(path),
			availableFilterSetIds,
		);
		presets.push(sidecarPreset?.id === runtimePreset.id ? sidecarPreset : runtimePreset);
	}
	return presets;
}

export function findBinding(bindings: readonly TablePresetFileBinding[], presetId: string): TablePresetFileBinding | null {
	return bindings.find(binding => binding.id === presetId) ?? null;
}

export function pathsEqual(left: string, right: string): boolean {
	return getOperonTableFilePathKey(left) === getOperonTableFilePathKey(right);
}
