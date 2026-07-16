import type { TableColumn, TablePreset, TablePresetFileBinding } from '../types/table';
import { isSafeTablePresetId } from '../types/table';
import type { DiscoveredOperonTableFile, OperonTableFileDescriptor } from '../types/table-file';
import {
	buildUniqueOperonTableFilePath,
	getOperonTableFilePathKey,
	isOperonTableFilePath,
	normalizeOperonTableFilePath,
} from './table-file';

export type TablePresetFileMigrationStatus = 'create' | 'adopt' | 'blocked' | 'already-migrated';

export type TablePresetFileMigrationBlockCode =
	| 'unsafe-legacy-id'
	| 'duplicate-legacy-id'
	| 'duplicate-binding-id'
	| 'duplicate-binding-path'
	| 'duplicate-journal-id'
	| 'duplicate-journal-path'
	| 'binding-journal-path-mismatch'
	| 'journal-content-mismatch'
	| 'multiple-same-id-files'
	| 'multiple-same-path-candidates'
	| 'invalid-same-path-candidate'
	| 'target-id-mismatch'
	| 'target-content-mismatch'
	| 'target-path-bound-to-other-id'
	| 'target-path-journaled-to-other-id'
	| 'occupied-target-path'
	| 'invalid-target-path';

export interface TablePresetFileMigrationJournalItem {
	id: string;
	path: string;
	semanticSignature: string;
}

export interface TablePresetFileMigrationPreflightInput<
	TDescriptor extends OperonTableFileDescriptor = OperonTableFileDescriptor,
> {
	legacyPresets: readonly TablePreset[];
	existingBindings: readonly TablePresetFileBinding[];
	discoveredFiles: readonly DiscoveredOperonTableFile<TDescriptor>[];
	existingPaths: Iterable<string>;
	destinationFolder: string;
	priorJournalItems?: readonly TablePresetFileMigrationJournalItem[];
	invalidFileIdClaims?: readonly { id: string; path: string }[];
}

export interface TablePresetFileMigrationItem<
	TDescriptor extends OperonTableFileDescriptor = OperonTableFileDescriptor,
> {
	id: string;
	status: TablePresetFileMigrationStatus;
	legacyPreset: TablePreset;
	targetPath: string | null;
	binding: TablePresetFileBinding | null;
	descriptor: TDescriptor | null;
	journalItem: TablePresetFileMigrationJournalItem | null;
	blockCodes: TablePresetFileMigrationBlockCode[];
}

export interface TablePresetFileMigrationPreflightResult<
	TDescriptor extends OperonTableFileDescriptor = OperonTableFileDescriptor,
> {
	items: TablePresetFileMigrationItem<TDescriptor>[];
	hasBlockedItems: boolean;
}

interface IndexedDiscoveredFile<TDescriptor extends OperonTableFileDescriptor> {
	file: DiscoveredOperonTableFile<TDescriptor>;
	path: string;
	pathKey: string;
}

export function buildTablePresetSemanticSignature(preset: TablePreset): string {
	return JSON.stringify(normalizeCompleteTablePresetContent(preset));
}

export function areTablePresetsSemanticallyEquivalent(left: TablePreset, right: TablePreset): boolean {
	return buildTablePresetSemanticSignature(left) === buildTablePresetSemanticSignature(right);
}

export function preflightTablePresetFileMigration<
	TDescriptor extends OperonTableFileDescriptor = OperonTableFileDescriptor,
>(input: TablePresetFileMigrationPreflightInput<TDescriptor>): TablePresetFileMigrationPreflightResult<TDescriptor> {
	const legacyById = groupBy(
		[...input.legacyPresets].sort((left, right) => compareStrings(left.id, right.id)
			|| compareStrings(buildTablePresetSemanticSignature(left), buildTablePresetSemanticSignature(right))),
		preset => preset.id,
	);
	const bindings = input.existingBindings
		.map(binding => ({ id: binding.id, path: normalizeOperonTableFilePath(binding.path) }))
		.sort((left, right) => compareStrings(left.id, right.id) || compareStrings(left.path, right.path));
	const journals = (input.priorJournalItems ?? [])
		.map(item => ({ ...item, path: normalizeOperonTableFilePath(item.path) }))
		.sort((left, right) => compareStrings(left.id, right.id)
			|| compareStrings(left.path, right.path)
			|| compareStrings(left.semanticSignature, right.semanticSignature));
	const bindingsById = groupBy(bindings, binding => binding.id);
	const journalsById = groupBy(journals, item => item.id);
	const bindingIdsByPath = groupIdsByPath(bindings);
	const journalIdsByPath = groupIdsByPath(journals);
	const discovered = input.discoveredFiles
		.map(file => {
			const path = normalizeOperonTableFilePath(file.path || file.descriptor.path);
			return { file, path, pathKey: getOperonTableFilePathKey(path) };
		})
		.sort((left, right) => compareStrings(left.pathKey, right.pathKey)
			|| compareStrings(left.path, right.path)
			|| compareStrings(left.file.descriptor.path, right.file.descriptor.path));
	const discoveredByPath = groupBy(discovered, file => file.pathKey);
	const discoveredById = groupBy(
		discovered.filter((file): file is IndexedDiscoveredFile<TDescriptor> & { file: DiscoveredOperonTableFile<TDescriptor> & { preset: TablePreset } } => !!file.file.preset),
		file => file.file.preset.id,
	);
	const invalidClaimsById = groupBy(
		(input.invalidFileIdClaims ?? []).map(claim => ({ ...claim, path: normalizeOperonTableFilePath(claim.path) })),
		claim => claim.id,
	);
	const occupiedPaths = new Set<string>();
	const physicalPaths = new Set<string>();
	for (const path of input.existingPaths) {
		const normalizedPath = normalizeOperonTableFilePath(path);
		occupiedPaths.add(normalizedPath);
		physicalPaths.add(normalizedPath);
	}
	for (const file of discovered) {
		occupiedPaths.add(file.path);
		physicalPaths.add(file.path);
	}
	for (const binding of bindings) occupiedPaths.add(binding.path);
	for (const journal of journals) occupiedPaths.add(journal.path);

	const destinationFolder = normalizeOperonTableFilePath(input.destinationFolder);
	const invalidDestination = startsOutsideVault(destinationFolder);
	const items: TablePresetFileMigrationItem<TDescriptor>[] = [];
	for (const id of [...legacyById.keys()].sort(compareStrings)) {
		const legacyMatches = legacyById.get(id)!;
		const legacyPreset = legacyMatches[0];
		const idBindings = bindingsById.get(id) ?? [];
		const idJournals = journalsById.get(id) ?? [];
		const binding = idBindings[0] ?? null;
		const journal = idJournals[0] ?? null;
		const blockCodes: TablePresetFileMigrationBlockCode[] = [];

		if (!isSafeTablePresetId(id)) blockCodes.push('unsafe-legacy-id');
		if (legacyMatches.length > 1) blockCodes.push('duplicate-legacy-id');
		if (idBindings.length > 1) blockCodes.push('duplicate-binding-id');
		if (idJournals.length > 1) blockCodes.push('duplicate-journal-id');
		if (binding && (bindingIdsByPath.get(getOperonTableFilePathKey(binding.path))?.size ?? 0) > 1) {
			blockCodes.push('duplicate-binding-path');
		}
		if (journal && (journalIdsByPath.get(getOperonTableFilePathKey(journal.path))?.size ?? 0) > 1) {
			blockCodes.push('duplicate-journal-path');
		}
		if (binding && journal && getOperonTableFilePathKey(binding.path) !== getOperonTableFilePathKey(journal.path)) {
			blockCodes.push('binding-journal-path-mismatch');
		}
		const semanticSignature = buildTablePresetSemanticSignature(legacyPreset);
		if (journal && journal.semanticSignature !== semanticSignature) blockCodes.push('journal-content-mismatch');
		if (invalidDestination && !binding && !journal) blockCodes.push('invalid-target-path');

		const sameIdFiles = discoveredById.get(id) ?? [];
		const invalidIdClaims = invalidClaimsById.get(id) ?? [];
		if (invalidIdClaims.length > 0) {
			items.push(blockedItem(legacyPreset, invalidIdClaims[0].path, ['invalid-same-path-candidate']));
			continue;
		}
		if (sameIdFiles.length > 1) blockCodes.push('multiple-same-id-files');
		const requested = requestedPath(binding, journal);
		if (requested !== null) addForeignPathClaimBlocks(blockCodes, id, requested, bindingIdsByPath, journalIdsByPath);
		if (requested !== null && sameIdFiles.length === 1) {
			addForeignPathClaimBlocks(blockCodes, id, sameIdFiles[0].path, bindingIdsByPath, journalIdsByPath);
		}
		if (blockCodes.length > 0) {
			items.push(blockedItem(legacyPreset, requested, blockCodes));
			continue;
		}

		if (requested !== null) {
			const requestedResult = reconcileRequestedPath(
				legacyPreset,
				requested,
				discoveredByPath,
				sameIdFiles,
				physicalPaths,
				semanticSignature,
			);
			items.push(requestedResult);
			if (requestedResult.status === 'create') occupiedPaths.add(requestedResult.targetPath!);
			continue;
		}

		if (sameIdFiles.length === 1) {
			const candidate = sameIdFiles[0];
			const candidateClaimBlocks: TablePresetFileMigrationBlockCode[] = [];
			addForeignPathClaimBlocks(candidateClaimBlocks, id, candidate.path, bindingIdsByPath, journalIdsByPath);
			if (candidateClaimBlocks.length > 0) {
				items.push(blockedItem(legacyPreset, candidate.path, candidateClaimBlocks, candidate.file.descriptor));
			} else if (candidate.file.status !== 'loaded') {
				items.push(blockedItem(legacyPreset, candidate.path, ['invalid-same-path-candidate'], candidate.file.descriptor));
			} else if (!areTablePresetsSemanticallyEquivalent(legacyPreset, candidate.file.preset)) {
				items.push(blockedItem(legacyPreset, candidate.path, ['target-content-mismatch'], candidate.file.descriptor));
			} else {
				items.push(actionItem('adopt', legacyPreset, candidate.path, candidate.file.descriptor, semanticSignature));
			}
			continue;
		}

		const targetPath = buildUniqueOperonTableFilePath(destinationFolder, legacyPreset.name, occupiedPaths);
		items.push(actionItem<TDescriptor>('create', legacyPreset, targetPath, null, semanticSignature));
		occupiedPaths.add(targetPath);
	}

	return { items, hasBlockedItems: items.some(item => item.status === 'blocked') };
}

export const reconcileTablePresetFileMigration = preflightTablePresetFileMigration;

function reconcileRequestedPath<TDescriptor extends OperonTableFileDescriptor>(
	legacyPreset: TablePreset,
	requestedPathValue: string,
	discoveredByPath: ReadonlyMap<string, IndexedDiscoveredFile<TDescriptor>[]>,
	sameIdFiles: readonly IndexedDiscoveredFile<TDescriptor>[],
	physicalPaths: ReadonlySet<string>,
	semanticSignature: string,
): TablePresetFileMigrationItem<TDescriptor> {
	if (!isSafeTargetPath(requestedPathValue)) return blockedItem(legacyPreset, requestedPathValue, ['invalid-target-path']);
	const pathCandidates = discoveredByPath.get(getOperonTableFilePathKey(requestedPathValue)) ?? [];
	if (pathCandidates.length > 0) {
		const blocked = blockForPathCandidates(legacyPreset, requestedPathValue, pathCandidates);
		if (blocked.blockCodes.length > 0) return blocked;
		const candidate = pathCandidates[0];
		return actionItem('already-migrated', legacyPreset, candidate.path, candidate.file.descriptor, semanticSignature);
	}
	if (sameIdFiles.length === 1) {
		const candidate = sameIdFiles[0];
		if (candidate.file.status !== 'loaded' || !candidate.file.preset) {
			return blockedItem(legacyPreset, candidate.path, ['invalid-same-path-candidate'], candidate.file.descriptor);
		}
		if (!areTablePresetsSemanticallyEquivalent(legacyPreset, candidate.file.preset)) {
			return blockedItem(legacyPreset, candidate.path, ['target-content-mismatch'], candidate.file.descriptor);
		}
		return actionItem('already-migrated', legacyPreset, candidate.path, candidate.file.descriptor, semanticSignature);
	}
	if (hasPath(physicalPaths, requestedPathValue)) return blockedItem(legacyPreset, requestedPathValue, ['occupied-target-path']);
	return actionItem<TDescriptor>('create', legacyPreset, requestedPathValue, null, semanticSignature);
}

function blockForPathCandidates<TDescriptor extends OperonTableFileDescriptor>(
	legacyPreset: TablePreset,
	path: string,
	candidates: readonly IndexedDiscoveredFile<TDescriptor>[],
): TablePresetFileMigrationItem<TDescriptor> {
	if (candidates.length > 1) return blockedItem(legacyPreset, path, ['multiple-same-path-candidates']);
	const candidate = candidates[0];
	if (candidate.file.status !== 'loaded' || !candidate.file.preset) {
		return blockedItem(legacyPreset, path, ['invalid-same-path-candidate'], candidate.file.descriptor);
	}
	if (candidate.file.preset.id !== legacyPreset.id) {
		return blockedItem(legacyPreset, path, ['target-id-mismatch'], candidate.file.descriptor);
	}
	if (!areTablePresetsSemanticallyEquivalent(legacyPreset, candidate.file.preset)) {
		return blockedItem(legacyPreset, path, ['target-content-mismatch'], candidate.file.descriptor);
	}
	return blockedItem(legacyPreset, path, [], candidate.file.descriptor);
}

function actionItem<TDescriptor extends OperonTableFileDescriptor>(
	status: Exclude<TablePresetFileMigrationStatus, 'blocked'>,
	legacyPreset: TablePreset,
	targetPath: string,
	descriptor: TDescriptor | null,
	semanticSignature: string,
): TablePresetFileMigrationItem<TDescriptor> {
	return {
		id: legacyPreset.id,
		status,
		legacyPreset,
		targetPath,
		binding: { id: legacyPreset.id, path: targetPath },
		descriptor,
		journalItem: { id: legacyPreset.id, path: targetPath, semanticSignature },
		blockCodes: [],
	};
}

function blockedItem<TDescriptor extends OperonTableFileDescriptor>(
	legacyPreset: TablePreset,
	targetPath: string | null,
	blockCodes: readonly TablePresetFileMigrationBlockCode[],
	descriptor: TDescriptor | null = null,
): TablePresetFileMigrationItem<TDescriptor> {
	return {
		id: legacyPreset.id,
		status: 'blocked',
		legacyPreset,
		targetPath,
		binding: null,
		descriptor,
		journalItem: null,
		blockCodes: [...new Set(blockCodes)],
	};
}

function requestedPath(
	binding: TablePresetFileBinding | null,
	journal: TablePresetFileMigrationJournalItem | null,
): string | null {
	return binding?.path ?? journal?.path ?? null;
}

function groupIdsByPath<T extends { id: string; path: string }>(values: readonly T[]): Map<string, Set<string>> {
	const result = new Map<string, Set<string>>();
	for (const value of values) {
		const key = getOperonTableFilePathKey(value.path);
		const ids = result.get(key) ?? new Set<string>();
		ids.add(value.id);
		result.set(key, ids);
	}
	return result;
}

function addForeignPathClaimBlocks(
	blockCodes: TablePresetFileMigrationBlockCode[],
	id: string,
	path: string,
	bindingIdsByPath: ReadonlyMap<string, ReadonlySet<string>>,
	journalIdsByPath: ReadonlyMap<string, ReadonlySet<string>>,
): void {
	const pathKey = getOperonTableFilePathKey(path);
	if ([...(bindingIdsByPath.get(pathKey) ?? [])].some(claimedId => claimedId !== id)) {
		blockCodes.push('target-path-bound-to-other-id');
	}
	if ([...(journalIdsByPath.get(pathKey) ?? [])].some(claimedId => claimedId !== id)) {
		blockCodes.push('target-path-journaled-to-other-id');
	}
}

function groupBy<T>(values: readonly T[], keyOf: (value: T) => string): Map<string, T[]> {
	const result = new Map<string, T[]>();
	for (const value of values) {
		const key = keyOf(value);
		result.set(key, [...(result.get(key) ?? []), value]);
	}
	return result;
}

function hasPath(paths: ReadonlySet<string>, path: string): boolean {
	const key = getOperonTableFilePathKey(path);
	for (const candidate of paths) {
		if (getOperonTableFilePathKey(candidate) === key) return true;
	}
	return false;
}

function isSafeTargetPath(path: string): boolean {
	return !!path && isOperonTableFilePath(path) && !startsOutsideVault(path);
}

function startsOutsideVault(path: string): boolean {
	return path === '..' || path.startsWith('../');
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeCompleteTablePresetContent(preset: TablePreset): unknown {
	return {
		id: preset.id,
		name: preset.name,
		filterSetId: preset.filterSetId,
		columns: preset.columns.map(normalizeColumn),
		sortRules: preset.sortRules.map(rule => ({ key: rule.key, direction: rule.direction, empty: rule.empty })),
		groupBy: preset.groupBy,
		groupOrder: preset.groupOrder,
		subgroupBy: preset.subgroupBy,
		subgroupOrder: preset.subgroupOrder,
		collapsedGroupKeys: [...preset.collapsedGroupKeys],
		summaries: preset.summaries.map(summary => ({ key: summary.key, function: summary.function })),
		display: { showSource: preset.display.showSource, density: preset.display.density },
		search: {
			scope: {
				projectMode: preset.search.scope.projectMode,
				showOverdue: preset.search.scope.showOverdue,
				showHappensToday: preset.search.scope.showHappensToday,
				showRecentModified: preset.search.scope.showRecentModified,
				includeInline: preset.search.scope.includeInline,
				includeFile: preset.search.scope.includeFile,
				includeCancelled: preset.search.scope.includeCancelled,
				includeFinished: preset.search.scope.includeFinished,
			},
			parent: preset.search.parent
				? {
					mode: preset.search.parent.mode,
					parentId: preset.search.parent.parentId,
					parentName: preset.search.parent.parentName ?? null,
				}
				: null,
		},
	};
}

function normalizeColumn(column: TableColumn): unknown {
	return {
		key: column.key,
		kind: column.kind,
		label: column.label ?? null,
		widthPx: column.widthPx ?? null,
		hidden: column.hidden ?? null,
		align: column.align ?? null,
		pinned: column.pinned ?? null,
		colorMode: column.colorMode ?? null,
		durationDisplayMode: column.durationDisplayMode ?? null,
		displayMode: column.displayMode ?? null,
	};
}
