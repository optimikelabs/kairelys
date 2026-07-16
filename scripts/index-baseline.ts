import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolve } from 'node:path';
import type { App } from 'obsidian';
import type { IndexData } from '../src/types/fields';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import { OperonIndexer } from '../src/indexer/indexer';
import { SecondaryIndexes } from '../src/indexer/secondary-indexes';
import {
	buildIndexV8Snapshot,
	getIndexV8CanonicalInstanceKeys,
	hydrateIndexV8Shards,
	hydrateValidatedIndexV8Snapshot,
	projectIndexDataToV8Sources,
	stableCompactStringify,
	utf8ByteLength,
	validateIndexV8Snapshot,
} from '../src/indexer/persistence/index-v8-codec';
import { createSyntheticIndexData, createV8SourcesFromIndexData } from './index-v8-fixtures';
import { IndexV8StorageError, IndexV8Store } from '../src/indexer/persistence/index-v8-store';
import type { IndexV8CommitResult, IndexV8SnapshotPayloads } from '../src/indexer/persistence/index-v8-store';
import {
	assertIndexV8IncrementalParity,
	assertIndexV8Parity,
	projectIndexV8IncrementalParity,
} from '../src/indexer/persistence/index-v8-parity';
import {
	buildIndexV8BaselineMembership,
	buildIndexV8RamSourceIndexes,
	compileIndexV8Incremental,
} from '../src/indexer/persistence/index-v8-incremental-compiler';
import {
	IndexV8ShadowWriter,
	IndexV8PersistenceCoordinator,
	sealIndexData,
	type IndexV8ShadowInput,
	type IndexV8ShadowScheduler,
	type IndexV8ShadowStore,
} from '../src/indexer/persistence/index-v8-shadow-writer';
import { buildOperonStoragePaths } from '../src/storage/operon-storage-paths';
import { IndexV8NodeAdapter } from './index-v8-node-adapter';
import { IndexV8MemoryAdapter } from './index-v8-memory-adapter';

const WARMUP_SAMPLES = 5;
const MEASURED_SAMPLES = 30;
const QUERY_ITERATIONS = 100;
const FIXED_TIME = '2026-01-02T03:04:05.000Z';
// Locked from the accepted Aşama 4 combined benchmark. Aşama 5 may add at
// most 20% to these same 5k/25k single-source end-to-end ratios.
const STAGE4_SINGLE_SOURCE_END_TO_END_P95_RATIO = new Map([
	[5_000, 0.425],
	[25_000, 0.509],
]);
// Locked from the accepted metadata-only Aşama 5 diagnostics profile.
const STAGE5_METADATA_DIAGNOSTICS_P95_MS = 3.233;

interface DistributionStats {
	totalShardBytes: number;
	manifestBytes: number;
	totalPayloadBytes: number;
	averageShardBytes: number;
	p95ShardBytes: number;
	maxShardBytes: number;
	maxToAverageRatio: number;
}

interface SampleStats {
	min: number;
	p50: number;
	p95: number;
	max: number;
}

interface CutoverBenchmarkProfile {
	label: string;
	timings: { metadataDiagnosticsMs: SampleStats };
	counts: { activeShards: number; taskInstances: number };
	performanceComparison: {
		stage5P95Ms: number;
		currentP95Ms: number;
		softLimitMs: number;
		hardLimitMs: number;
		softReviewRequired: boolean;
		hardGatePassed: boolean;
	};
	integrity: {
		metadataDiagnosticsReadZeroShardPayloads: boolean;
		legacyCacheDetectedWithoutRead: boolean;
		retirementPlanSealed: boolean;
	};
}

interface BenchmarkProfile {
	label: string;
	counts: {
		canonicalTasks: number;
		taskInstances: number;
		sources: number;
		shards: number;
	};
	bytes: {
		v7PrettyJson: number;
		v8: DistributionStats;
		v8ToV7Ratio: number;
	};
	integrity: {
		deterministicPayload: boolean;
		taskInstanceCountParity: boolean;
		canonicalTaskCountParity: boolean;
		taskInstanceSemanticParity: boolean;
		canonicalTaskSemanticParity: boolean;
	};
	timings: Record<string, SampleStats>;
	heapDeltaBytes: object;
}

interface StorageBenchmarkProfile {
	label: string;
	ioConcurrency: number;
	timings: {
		coldCommitMs: SampleStats;
		warmNoopCommitMs: SampleStats;
		incrementalCommitMs: SampleStats;
		loadMs: SampleStats;
	};
	io: {
		cold: StorageWriteSummary;
		warm: StorageWriteSummary;
		incremental: StorageWriteSummary;
	};
	integrity: {
		coldWrites32Shards: boolean;
		warmWritesNothing: boolean;
		incrementalWritesOneShard: boolean;
		loadReturnsCommittedSnapshot: boolean;
	};
}

interface StorageWriteSummary {
	shardsWritten: number;
	shardsReused: number;
	bytesWritten: number;
	manifestWritten: boolean;
}

interface ShadowBenchmarkProfile {
	label: string;
	counts: { canonicalTasks: number; taskInstances: number; sources: number };
	timings: {
		sealMs: SampleStats;
		compileMs: SampleStats;
		parityMs: SampleStats;
		compileAndParityMs: SampleStats;
		commitMs: SampleStats;
	};
	integrity: {
		parity: boolean;
		manifestHas32Shards: boolean;
	};
}

interface ShadowBurstProfile {
	events: number;
	attempted: number;
	succeeded: number;
	coalesced: number;
	maxPendingDepth: number;
	finalSequence: number;
	finalManifestMatchesLatest: boolean;
}

interface HydratedBenchmarkState {
	tasks: Map<string, IndexData['tasks'][string]>;
	taskInstances: Map<string, NonNullable<IndexData['taskInstances']>[string]>;
	secondary: SecondaryIndexes;
}

interface RepresentativeQuerySpec {
	operonId: string;
	parentId: string;
	filePath: string;
	workflowStatus: string;
	priority: string;
}

interface HydrationBenchmarkProfile {
	label: string;
	counts: {
		canonicalTasks: number;
		taskInstances: number;
		sources: number;
		v8ShardsRead: number;
	};
	timings: {
		v7PhysicalLoadMs: SampleStats;
		v8PhysicalLoadMs: SampleStats;
		missingV8FallbackToV7Ms: SampleStats;
		v7RepresentativeQueriesUs: SampleStats;
		v8RepresentativeQueriesUs: SampleStats;
	};
	heapDeltaBytes: {
		available: boolean;
		measurement?: 'steady-retained-state-after-gc';
		v7SteadyState?: SampleStats;
		v8SteadyState?: SampleStats;
		reason?: string;
	};
	comparison: {
		v8ToV7LoadP95Ratio: number;
		v8ToV7HeapP95Ratio: number | null;
	};
	integrity: {
		v8Loaded32Shards: boolean;
		fallbackUsedV7: boolean;
		taskInstanceCountParity: boolean;
		canonicalTaskCountParity: boolean;
		taskInstanceSemanticParity: boolean;
		canonicalTaskSemanticParity: boolean;
		secondaryIndexParity: boolean;
		representativeQueryParity: boolean;
	};
}

interface IncrementalBenchmarkProfile {
	label: string;
	counts: {
		taskInstances: number;
		dirtySources: number;
		dirtyShards: number;
	};
	timings: {
		incrementalEndToEndPreparationAndCompileMs: SampleStats;
		fullEndToEndPreparationAndCompileMs: SampleStats;
		incrementalCompileMs: SampleStats;
		fullCompileMs: SampleStats;
		incrementalCompileAndParityMs: SampleStats;
		fullCompileAndParityMs: SampleStats;
		incrementalCommitMs: SampleStats;
	};
	comparison: {
		incrementalToFullEndToEndP95Ratio: number;
		incrementalToFullP95Ratio: number;
		incrementalToFullCompileAndParityP95Ratio: number;
	};
	io: {
		shardsWritten: number;
		shardsReused: number;
		bytesWritten: number;
	};
	heapDeltaBytes: {
		available: boolean;
		sourceIndexesAndBaselineMembership?: SampleStats;
		reason?: string;
	};
	integrity: {
		manifestMatchesFullCompile: boolean;
		shardPayloadsMatchFullCompile: boolean;
		validatedSnapshot: boolean;
		singleSourceWritesOneShard: boolean;
	};
}

interface SyncBenchmarkProfile {
	label: string;
	timings: {
		settlePhaseTransitionMs: SampleStats;
		inventoryMs: Record<'32' | '128' | '512', SampleStats>;
		cleanupApplyMs: SampleStats;
		rebaseCasMs: Record<'1' | '10' | '100', SampleStats>;
		fingerprintRevalidationMs: SampleStats;
	};
	heapDeltaBytes: {
		available: boolean;
		verifiedShardFingerprints?: SampleStats;
		reason?: string;
	};
	integrity: {
		metadataInventoryReadsZeroShards: boolean;
		cleanupWithin32FilesAnd16Mb: boolean;
		staleCleanupDeletesNothing: boolean;
		rebaseCasUsesExpectedBase: boolean;
		fingerprintMutationDetected: boolean;
		emergencyPhaseIsTerminal: boolean;
	};
}

let queryResultSink = 0;

async function measure(action: () => void | Promise<void>): Promise<SampleStats> {
	for (let index = 0; index < WARMUP_SAMPLES; index++) {
		await action();
		global.gc?.();
	}
	const samples: number[] = [];
	for (let index = 0; index < MEASURED_SAMPLES; index++) {
		global.gc?.();
		const startedAt = performance.now();
		await action();
		samples.push(performance.now() - startedAt);
	}
	return summarize(samples);
}

async function measureWithSetup(setup: () => Promise<void>, action: () => Promise<void>): Promise<SampleStats> {
	for (let index = 0; index < WARMUP_SAMPLES; index++) {
		await setup();
		await action();
		global.gc?.();
	}
	const samples: number[] = [];
	for (let index = 0; index < MEASURED_SAMPLES; index++) {
		global.gc?.();
		await setup();
		const startedAt = performance.now();
		await action();
		samples.push(performance.now() - startedAt);
	}
	return summarize(samples);
}

async function measureMicrosecondsPerOperation(action: () => void): Promise<SampleStats> {
	const milliseconds = await measure(() => {
		for (let index = 0; index < QUERY_ITERATIONS; index++) action();
	});
	return Object.fromEntries(
		Object.entries(milliseconds).map(([key, value]) => [key, round(value * 1_000 / QUERY_ITERATIONS)]),
	) as unknown as SampleStats;
}

function summarize(samples: number[]): SampleStats {
	const sorted = [...samples].sort((left, right) => left - right);
	return {
		min: round(sorted[0]),
		p50: round(percentile(sorted, 0.5)),
		p95: round(percentile(sorted, 0.95)),
		max: round(sorted[sorted.length - 1]),
	};
}

function percentile(sorted: number[], quantile: number): number {
	return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}

async function measureAsyncHeapDelta(action: () => Promise<HydratedBenchmarkState>): Promise<SampleStats> {
	const samples: number[] = [];
	for (let index = 0; index < MEASURED_SAMPLES; index++) {
		samples.push(await measureSingleAsyncHeapDelta(action));
		global.gc?.();
	}
	return summarize(samples);
}

async function measureSingleAsyncHeapDelta(
	action: () => Promise<HydratedBenchmarkState>,
): Promise<number> {
	global.gc?.();
	const before = process.memoryUsage().heapUsed;
	const state = await action();
	global.gc?.();
	const retainedBytes = process.memoryUsage().heapUsed - before;
	queryResultSink += state.tasks.size + state.taskInstances.size;
	return retainedBytes;
}

function measureIncrementalHelperHeapDelta(data: Readonly<IndexData>, sampleCount = 15): SampleStats | null {
	if (typeof global.gc !== 'function') return null;
	const samples: number[] = [];
	for (let index = 0; index < sampleCount; index++) {
		global.gc();
		const before = process.memoryUsage().heapUsed;
		const retained = buildIndexV8RamSourceIndexes(data);
		const baselineMembership = buildIndexV8BaselineMembership(data);
		global.gc();
		samples.push(process.memoryUsage().heapUsed - before);
		queryResultSink += retained.sourceInstanceKeys.size
			+ retained.sourcePathsByShard.size
			+ baselineMembership.sourceOperonIds.size
			+ baselineMembership.sourcePathsByOperonId.size
			+ baselineMembership.canonicalSourceByOperonId.size;
	}
	return summarize(samples);
}

async function measureSyncMaintenanceHeapDelta(
	snapshot: Awaited<ReturnType<typeof buildIndexV8Snapshot>>,
	paths: ReturnType<typeof buildOperonStoragePaths>['runtime']['indexV8'],
	sampleCount = 15,
): Promise<SampleStats | null> {
	if (typeof global.gc !== 'function') return null;
	const samples: number[] = [];
	for (let index = 0; index < sampleCount; index++) {
		const adapter = new IndexV8MemoryAdapter();
		await new IndexV8Store(adapter.asDataAdapter(), paths).commit({ ...snapshot, expectedBaseMissing: true });
		const reader = new IndexV8Store(adapter.asDataAdapter(), paths);
		global.gc();
		const before = process.memoryUsage().heapUsed;
		await (async () => {
			const loaded = await reader.load();
			if (loaded.status !== 'loaded') throw new Error('Sync heap benchmark failed to load snapshot');
			queryResultSink += loaded.manifest.shards.length;
		})();
		global.gc();
		samples.push(process.memoryUsage().heapUsed - before);
		queryResultSink += (reader as unknown as {
			verifiedShardFingerprints: ReadonlyMap<string, unknown>;
		}).verifiedShardFingerprints.size;
	}
	return summarize(samples);
}

function getDistribution(shardBytes: number[], manifestBytes: number): DistributionStats {
	const sorted = [...shardBytes].sort((left, right) => left - right);
	const totalShardBytes = shardBytes.reduce((total, value) => total + value, 0);
	const averageShardBytes = totalShardBytes / shardBytes.length;
	const maxShardBytes = sorted[sorted.length - 1];
	return {
		totalShardBytes,
		manifestBytes,
		totalPayloadBytes: totalShardBytes + manifestBytes,
		averageShardBytes: round(averageShardBytes),
		p95ShardBytes: percentile(sorted, 0.95),
		maxShardBytes,
		maxToAverageRatio: round(maxShardBytes / averageShardBytes),
	};
}

async function benchmarkProfile(label: string, data: IndexData): Promise<BenchmarkProfile> {
	const v7Payload = JSON.stringify(data, null, '\t');
	const projectedSources = label.startsWith('synthetic-')
		? createV8SourcesFromIndexData(data)
		: projectIndexDataToV8Sources(data);
	const snapshotInput = {
		committedAt: FIXED_TIME,
		lastFullScanAt: data.lastFullReindex || FIXED_TIME,
		coherenceBasis: 'verified-full-scan' as const,
		indexSemanticsSignature: data.workflowStatusSemanticsSignature || 'benchmark-semantics',
		sources: projectedSources,
		canonicalInstanceKeys: getIndexV8CanonicalInstanceKeys(data),
	};
	const snapshot = await buildIndexV8Snapshot(snapshotInput);
	const deterministicSnapshot = await buildIndexV8Snapshot({
		...snapshotInput,
		sources: [...snapshotInput.sources].reverse(),
	});
	const parsedShards = snapshot.shards;
	const hydrated = hydrateIndexV8Shards(parsedShards);
	const secondary = new SecondaryIndexes();
	secondary.rebuild(hydrated.tasks);
	const representativeTask = hydrated.tasks.values().next().value;
	const childTask = [...hydrated.tasks.values()].find(task => !!task.fieldValues['parentTask']);
	const representativeParent = childTask?.fieldValues['parentTask'] ?? representativeTask?.operonId ?? 'benchmark-missing-parent';
	const representativeStatus = representativeTask?.fieldValues['status'] ?? 'benchmark-missing-status';
	const representativePriority = representativeTask?.fieldValues['priority'] ?? 'benchmark-missing-priority';

	const timings = {
		v7ParseMs: await measure(() => { JSON.parse(v7Payload) as unknown; }),
		v7PrettyStringifyMs: await measure(() => { JSON.stringify(data, null, '\t'); }),
		v7CachedLoadPipelineMs: await measure(() => {
			hydrateV7CachedLoad(JSON.parse(v7Payload) as IndexData);
		}),
		v8ProjectionMs: await measure(() => { projectIndexDataToV8Sources(data); }),
		v8SnapshotBuildMs: await measure(async () => { await buildIndexV8Snapshot(snapshotInput); }),
		v8ValidateSnapshotMs: await measure(async () => {
			await validateIndexV8Snapshot(snapshot.manifestPayload, snapshot.shardPayloads);
		}),
		v8CachedLoadPipelineMs: await measure(async () => {
			const validated = await validateIndexV8Snapshot(snapshot.manifestPayload, snapshot.shardPayloads);
			const pipelineHydrated = hydrateIndexV8Shards(validated.shards);
			const indexes = new SecondaryIndexes();
			indexes.rebuild(pipelineHydrated.tasks);
			queryResultSink += pipelineHydrated.tasks.size;
		}),
		v8ParseMs: await measure(() => {
			for (const payload of snapshot.shardPayloads.values()) JSON.parse(payload) as unknown;
		}),
		v8HydrationMs: await measure(() => { hydrateIndexV8Shards(parsedShards); }),
		secondaryRebuildMs: await measure(() => {
			const indexes = new SecondaryIndexes();
			indexes.rebuild(hydrated.tasks);
		}),
		queryTaskByIdUs: await measureMicrosecondsPerOperation(() => {
			queryResultSink += hydrated.tasks.get(representativeTask?.operonId ?? '') ? 1 : 0;
		}),
		queryOpenUs: await measureMicrosecondsPerOperation(() => { queryResultSink += secondary.getOpenTaskIds().size; }),
		queryDueRangeUs: await measureMicrosecondsPerOperation(() => {
			queryResultSink += secondary.getTasksDueInRange('2026-02-14', '2026-02-14').length;
		}),
		queryChildrenUs: await measureMicrosecondsPerOperation(() => { queryResultSink += secondary.getChildIds(representativeParent).size; }),
		queryWorkflowStatusUs: await measureMicrosecondsPerOperation(() => {
			queryResultSink += secondary.getTaskIdsByWorkflowStatus(representativeStatus).size;
		}),
		queryPriorityUs: await measureMicrosecondsPerOperation(() => {
			queryResultSink += secondary.getTaskIdsByPriority(representativePriority).size;
		}),
	};

	const canMeasureHeap = typeof global.gc === 'function';
	const heapSamples: number[] = [];
	if (canMeasureHeap) {
		for (let index = 0; index < MEASURED_SAMPLES; index++) {
			global.gc?.();
			const before = process.memoryUsage().heapUsed;
			const heapHydrated = hydrateIndexV8Shards(parsedShards);
			heapSamples.push(process.memoryUsage().heapUsed - before);
			if (heapHydrated.taskInstances.size < 0) throw new Error('Unreachable heap benchmark guard');
		}
	}
	const shardBytes = snapshot.manifest.shards.map(descriptor => descriptor.bytes);
	const distribution = getDistribution(shardBytes, utf8ByteLength(snapshot.manifestPayload));
	return {
		label,
		counts: {
			canonicalTasks: Object.keys(data.tasks).length,
			taskInstances: Object.keys(data.taskInstances ?? {}).length || Object.keys(data.tasks).length,
			sources: projectedSources.length,
			shards: snapshot.manifest.shards.length,
		},
		bytes: {
			v7PrettyJson: utf8ByteLength(v7Payload),
			v8: distribution,
			v8ToV7Ratio: round(distribution.totalPayloadBytes / utf8ByteLength(v7Payload)),
		},
		integrity: {
			deterministicPayload: snapshot.manifestPayload === deterministicSnapshot.manifestPayload
				&& [...snapshot.shardPayloads].every(([shardId, payload]) => (
				deterministicSnapshot.shardPayloads.get(shardId) === payload
			)),
			taskInstanceCountParity: hydrated.taskInstances.size === (Object.keys(data.taskInstances ?? {}).length || Object.keys(data.tasks).length),
			canonicalTaskCountParity: hydrated.tasks.size === Object.keys(data.tasks).length,
			taskInstanceSemanticParity: Object.entries(data.taskInstances ?? {}).every(([instanceKey, task]) => (
				tasksSemanticallyEqual(task, hydrated.taskInstances.get(instanceKey))
			)),
			canonicalTaskSemanticParity: Object.entries(data.tasks).every(([operonId, task]) => (
				tasksSemanticallyEqual(task, hydrated.tasks.get(operonId))
			)),
		},
		timings,
		heapDeltaBytes: canMeasureHeap
			? { available: true, v8Hydration: summarize(heapSamples) }
			: { available: false, reason: 'Run Node with exposed GC for stable heap deltas' },
	};
}

function tasksSemanticallyEqual(
	left: IndexData['tasks'][string],
	right: IndexData['tasks'][string] | undefined,
): boolean {
	if (!right) return false;
	const normalize = (task: IndexData['tasks'][string]) => {
		const { tier: _tier, ...persistedSemanticFields } = task;
		const { pinned: _pinned, ...fieldValues } = persistedSemanticFields.fieldValues;
		return { ...persistedSemanticFields, fieldValues };
	};
	return stableCompactStringify(normalize(left)) === stableCompactStringify(normalize(right));
}

function hydrateV7CachedLoad(data: IndexData): HydratedBenchmarkState {
	const taskInstances = new Map<string, NonNullable<IndexData['taskInstances']>[string]>();
	const byOperonId = new Map<string, string[]>();
	for (const [instanceKey, task] of Object.entries(data.taskInstances ?? {})) {
		delete task.fieldValues['pinned'];
		const hydrated = {
			...task,
			instanceKey,
		};
		taskInstances.set(instanceKey, hydrated);
		const keys = byOperonId.get(task.operonId) ?? [];
		keys.push(instanceKey);
		byOperonId.set(task.operonId, keys);
	}
	const tasks = new Map<string, IndexData['tasks'][string]>();
	if (taskInstances.size > 0) {
		for (const [operonId, instanceKeys] of byOperonId) {
			const persistedCanonical = data.tasks[operonId];
			const canonicalKey = persistedCanonical
				? `${persistedCanonical.primary.format}:${persistedCanonical.primary.filePath}:${persistedCanonical.primary.lineNumber}`
				: [...instanceKeys].sort((left, right) => left.localeCompare(right))[0];
			const instance = taskInstances.get(canonicalKey) ?? taskInstances.get(instanceKeys[0]);
			if (!instance) continue;
			const task = { ...instance };
			delete (task as { instanceKey?: string }).instanceKey;
			tasks.set(operonId, task);
		}
	} else {
		for (const [operonId, task] of Object.entries(data.tasks)) tasks.set(operonId, task);
	}
	const secondary = new SecondaryIndexes();
	secondary.rebuild(tasks);
	queryResultSink += taskInstances.size + tasks.size;
	return { tasks, taskInstances, secondary };
}

async function loadV7Physical(filePath: string): Promise<HydratedBenchmarkState> {
	return hydrateV7CachedLoad(JSON.parse(await readFile(filePath, 'utf8')) as IndexData);
}

async function loadV8Physical(store: IndexV8Store): Promise<HydratedBenchmarkState> {
	const loaded = await store.load();
	if (loaded.status !== 'loaded') throw new Error(`Hydration benchmark expected loaded V8 snapshot, got ${loaded.status}`);
	const hydrated = hydrateValidatedIndexV8Snapshot(loaded.validatedSnapshot, Date.parse(FIXED_TIME));
	const secondary = new SecondaryIndexes();
	secondary.rebuild(hydrated.tasks);
	return { tasks: hydrated.tasks, taskInstances: hydrated.taskInstances, secondary };
}

function getRepresentativeQuerySpec(data: IndexData): RepresentativeQuerySpec {
	const representativeTask = Object.values(data.tasks)[0];
	const child = Object.values(data.tasks).find(task => !!task.fieldValues['parentTask']);
	return {
		operonId: representativeTask?.operonId ?? 'benchmark-missing-task',
		parentId: child?.fieldValues['parentTask'] ?? representativeTask?.operonId ?? 'benchmark-missing-parent',
		filePath: representativeTask?.primary.filePath ?? 'benchmark-missing-file',
		workflowStatus: representativeTask?.fieldValues['status'] ?? 'benchmark-missing-status',
		priority: representativeTask?.fieldValues['priority'] ?? 'benchmark-missing-priority',
	};
}

function getRepresentativeQueryDigest(state: HydratedBenchmarkState, spec: RepresentativeQuerySpec): string {
	return stableCompactStringify({
		primary: state.tasks.has(spec.operonId),
		open: [...state.secondary.getOpenTaskIds()].sort(),
		due: state.secondary.getTasksDueInRange('2026-02-01', '2026-02-28').sort(),
		parent: [...state.secondary.getChildIds(spec.parentId)].sort(),
		file: [...state.secondary.getTasksInFile(spec.filePath)].sort(),
		workflowStatus: [...state.secondary.getTaskIdsByWorkflowStatus(spec.workflowStatus)].sort(),
		priority: [...state.secondary.getTaskIdsByPriority(spec.priority)].sort(),
	});
}

function executeRepresentativeQueries(state: HydratedBenchmarkState, spec: RepresentativeQuerySpec): number {
	return (state.tasks.has(spec.operonId) ? 1 : 0)
		+ state.secondary.getOpenTaskIds().size
		+ state.secondary.getTasksDueInRange('2026-02-01', '2026-02-28').length
		+ state.secondary.getChildIds(spec.parentId).size
		+ state.secondary.getTasksInFile(spec.filePath).size
		+ state.secondary.getTaskIdsByWorkflowStatus(spec.workflowStatus).size
		+ state.secondary.getTaskIdsByPriority(spec.priority).size;
}

function getSecondaryIndexDigest(state: HydratedBenchmarkState): string {
	const mapDigest = (map: Map<string, Set<string>>) => [...map]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, values]) => [key, [...values].sort()]);
	return stableCompactStringify({
		status: mapDigest(state.secondary.byStatus),
		due: [...state.secondary.byDue].sort((left, right) => (
			left.dateDue.localeCompare(right.dateDue) || left.operonId.localeCompare(right.operonId)
		)),
		parent: mapDigest(state.secondary.byParent),
		file: mapDigest(state.secondary.byFile),
		workflowStatus: mapDigest(state.secondary.byWorkflowStatus),
		priority: mapDigest(state.secondary.byPriority),
	});
}

async function benchmarkHydrationProfile(count: number): Promise<HydrationBenchmarkProfile> {
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), `operon-index-v8-hydration-${count}-`));
	const v7Path = path.join(temporaryRoot, 'index-v7.json');
	const adapter = new IndexV8NodeAdapter(temporaryRoot);
	const paths = buildOperonStoragePaths('.obsidian', `operon-hydration-benchmark-${count}`).runtime.indexV8;
	const missingPaths = buildOperonStoragePaths('.obsidian', `operon-hydration-missing-${count}`).runtime.indexV8;
	const data = createSyntheticIndexData(count);
	const sourceStats = buildBenchmarkSourceStats(data);
	const snapshot = await buildIndexV8Snapshot({
		committedAt: FIXED_TIME,
		lastFullScanAt: FIXED_TIME,
		coherenceBasis: 'verified-full-scan',
		indexSemanticsSignature: 'hydration-benchmark-v1',
		sources: projectIndexDataToV8Sources(data, sourceStats),
		canonicalInstanceKeys: getIndexV8CanonicalInstanceKeys(data),
	});
	const store = new IndexV8Store(adapter.asDataAdapter(), paths);
	const missingStore = new IndexV8Store(adapter.asDataAdapter(), missingPaths);
	try {
		await writeFile(v7Path, JSON.stringify(data, null, '\t'), 'utf8');
		await store.commit(snapshot);
		const v7Probe = await loadV7Physical(v7Path);
		const v8LoadProbe = await store.load();
		if (v8LoadProbe.status !== 'loaded') throw new Error('Hydration benchmark V8 probe did not load');
		const v8Probe = await loadV8Physical(store);
		let fallbackUsedV7 = false;
		const loadWithMissingFallback = async (): Promise<HydratedBenchmarkState> => {
			const result = await missingStore.load();
			if (result.status !== 'missing') throw new Error(`Expected missing V8 fallback probe, got ${result.status}`);
			fallbackUsedV7 = true;
			return await loadV7Physical(v7Path);
		};
		await loadWithMissingFallback();
		const querySpec = getRepresentativeQuerySpec(data);
		const v7QueryDigest = getRepresentativeQueryDigest(v7Probe, querySpec);
		const v8QueryDigest = getRepresentativeQueryDigest(v8Probe, querySpec);
		const timings = {
			v7PhysicalLoadMs: await measure(async () => { await loadV7Physical(v7Path); }),
			v8PhysicalLoadMs: await measure(async () => { await loadV8Physical(store); }),
			missingV8FallbackToV7Ms: await measure(async () => { await loadWithMissingFallback(); }),
			v7RepresentativeQueriesUs: await measureMicrosecondsPerOperation(() => {
				queryResultSink += executeRepresentativeQueries(v7Probe, querySpec);
			}),
			v8RepresentativeQueriesUs: await measureMicrosecondsPerOperation(() => {
				queryResultSink += executeRepresentativeQueries(v8Probe, querySpec);
			}),
		};
		const canMeasureHeap = typeof global.gc === 'function';
		const v7Heap = canMeasureHeap ? await measureAsyncHeapDelta(async () => await loadV7Physical(v7Path)) : null;
		const v8Heap = canMeasureHeap ? await measureAsyncHeapDelta(async () => await loadV8Physical(store)) : null;
		const originalInstances = Object.entries(data.taskInstances ?? {});
		return {
			label: `synthetic-${count}-hydration`,
			counts: {
				canonicalTasks: v8Probe.tasks.size,
				taskInstances: v8Probe.taskInstances.size,
				sources: snapshot.manifest.totals.sourceCount,
				v8ShardsRead: v8LoadProbe.metrics.shardsRead,
			},
			timings,
			heapDeltaBytes: canMeasureHeap && v7Heap && v8Heap
				? {
					available: true,
					measurement: 'steady-retained-state-after-gc',
					v7SteadyState: v7Heap,
					v8SteadyState: v8Heap,
				}
				: { available: false, reason: 'Run Node with exposed GC for stable heap deltas' },
			comparison: {
				v8ToV7LoadP95Ratio: round(timings.v8PhysicalLoadMs.p95 / timings.v7PhysicalLoadMs.p95),
				v8ToV7HeapP95Ratio: v7Heap && v8Heap && v7Heap.p95 !== 0
					? round(v8Heap.p95 / v7Heap.p95)
					: null,
			},
			integrity: {
				v8Loaded32Shards: v8LoadProbe.metrics.shardsRead === 32 && v8LoadProbe.manifest.shards.length === 32,
				fallbackUsedV7,
				taskInstanceCountParity: v7Probe.taskInstances.size === v8Probe.taskInstances.size,
				canonicalTaskCountParity: v7Probe.tasks.size === v8Probe.tasks.size,
				taskInstanceSemanticParity: originalInstances.every(([instanceKey, task]) => (
					tasksSemanticallyEqual(task, v8Probe.taskInstances.get(instanceKey))
				)),
				canonicalTaskSemanticParity: Object.entries(data.tasks).every(([operonId, task]) => (
					tasksSemanticallyEqual(task, v8Probe.tasks.get(operonId))
				)),
				secondaryIndexParity: getSecondaryIndexDigest(v7Probe) === getSecondaryIndexDigest(v8Probe),
				representativeQueryParity: v7QueryDigest === v8QueryDigest,
			},
		};
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

async function loadLiveIndex(): Promise<{ data: IndexData | null; reason: string | null }> {
	if (!process.argv.includes('--live')) return { data: null, reason: 'not-requested' };
	try {
		return {
			data: JSON.parse(await readFile(resolve(process.cwd(), 'runtime/index.json'), 'utf8')) as IndexData,
			reason: null,
		};
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
			return { data: null, reason: 'runtime-index-missing' };
		}
		throw error;
	}
}

async function benchmarkStorageProfile(count: number, ioConcurrency: number): Promise<StorageBenchmarkProfile> {
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), `operon-index-v8-storage-${count}-${ioConcurrency}-`));
	const adapter = new IndexV8NodeAdapter(temporaryRoot);
	const paths = buildOperonStoragePaths('.obsidian', 'operon-benchmark').runtime.indexV8;
	const data = createSyntheticIndexData(count);
	const changedData = structuredClone(data);
	const firstTask = Object.values(changedData.tasks)[0];
	const firstInstance = Object.values(changedData.taskInstances ?? {})[0];
	if (firstTask) firstTask.description += ' changed';
	if (firstInstance) firstInstance.description += ' changed';
	const base = await buildIndexV8Snapshot({
		committedAt: FIXED_TIME,
		lastFullScanAt: FIXED_TIME,
		coherenceBasis: 'verified-full-scan',
		indexSemanticsSignature: 'storage-benchmark-v1',
		sources: createV8SourcesFromIndexData(data),
	});
	const changed = await buildIndexV8Snapshot({
		committedAt: '2026-01-02T03:05:05.000Z',
		lastFullScanAt: FIXED_TIME,
		coherenceBasis: 'verified-full-scan',
		indexSemanticsSignature: 'storage-benchmark-v1',
		sources: createV8SourcesFromIndexData(changedData),
	});
	const changedDescriptor = changed.manifest.shards.find(descriptor => (
		base.manifest.shards.find(candidate => candidate.shardId === descriptor.shardId)?.sha256 !== descriptor.sha256
	));
	if (!changedDescriptor) throw new Error('Storage benchmark expected one changed shard');
	const changedShardPath = `${paths.shardsPath}/${changedDescriptor.shardId}-${changedDescriptor.sha256}.json`;
	let store = new IndexV8Store(adapter.asDataAdapter(), paths, { ioConcurrency });
	try {
		const coldCommitMs = await measureWithSetup(
			async () => {
				await adapter.reset();
				store = new IndexV8Store(adapter.asDataAdapter(), paths, { ioConcurrency });
			},
			async () => { await store.commit(base); },
		);
		await adapter.reset();
		store = new IndexV8Store(adapter.asDataAdapter(), paths, { ioConcurrency });
		const coldProbe = await store.commit(base);
		const warmProbe = await store.commit(base);
		const warmNoopCommitMs = await measure(async () => { await store.commit(base); });
		const incrementalCommitMs = await measureWithSetup(
			async () => {
				await adapter.process(paths.manifestPath, () => base.manifestPayload);
				await adapter.remove(changedShardPath);
			},
			async () => { await store.commit(changed); },
		);
		await adapter.process(paths.manifestPath, () => base.manifestPayload);
		await adapter.remove(changedShardPath);
		const incrementalProbe = await store.commit(changed);
		const loadMs = await measure(async () => { await store.load(); });
		const loaded = await store.load();
		return {
			label: `synthetic-${count}-storage`,
			ioConcurrency,
			timings: { coldCommitMs, warmNoopCommitMs, incrementalCommitMs, loadMs },
			io: {
				cold: summarizeWrite(coldProbe),
				warm: summarizeWrite(warmProbe),
				incremental: summarizeWrite(incrementalProbe),
			},
			integrity: {
				coldWrites32Shards: coldProbe.shardsWritten === 32 && coldProbe.manifestWritten,
				warmWritesNothing: warmProbe.shardsWritten === 0 && !warmProbe.manifestWritten,
				incrementalWritesOneShard: incrementalProbe.shardsWritten === 1 && incrementalProbe.shardsReused === 31,
				loadReturnsCommittedSnapshot: loaded.status === 'loaded' && loaded.manifest.snapshotId === changed.manifest.snapshotId,
			},
		};
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

function summarizeWrite(result: Awaited<ReturnType<IndexV8Store['commit']>>): StorageWriteSummary {
	return {
		shardsWritten: result.shardsWritten,
		shardsReused: result.shardsReused,
		bytesWritten: result.bytesWritten,
		manifestWritten: result.manifestWritten,
	};
}

function buildBenchmarkSourceStats(data: IndexData): Map<string, { mtimeMs: number; sizeBytes: number }> {
	const stats = new Map<string, { mtimeMs: number; sizeBytes: number }>();
	for (const task of Object.values(data.taskInstances ?? data.tasks)) {
		stats.set(task.primary.filePath, {
			mtimeMs: Date.parse(FIXED_TIME),
			sizeBytes: Math.max(1, task.primary.filePath.length * 10),
		});
	}
	return stats;
}

async function benchmarkIncrementalProfile(
	count: number,
	dirtySourceCount: number,
): Promise<IncrementalBenchmarkProfile> {
	const data = createSyntheticIndexData(count);
	const baseStats = buildBenchmarkSourceStats(data);
	const base = await buildIndexV8Snapshot({
		committedAt: FIXED_TIME,
		lastFullScanAt: FIXED_TIME,
		coherenceBasis: 'verified-full-scan',
		indexSemanticsSignature: 'incremental-benchmark-v1',
		sources: projectIndexDataToV8Sources(data, baseStats),
		canonicalInstanceKeys: getIndexV8CanonicalInstanceKeys(data),
	});
	const changed = structuredClone(data);
	const changedStats = new Map(baseStats);
	const sourcePaths = [...new Set(Object.values(changed.taskInstances ?? {}).map(instance => instance.primary.filePath))]
		.slice(0, dirtySourceCount);
	const selectedPaths = new Set(sourcePaths);
	const affectedOperonIds = new Set<string>();
	for (const instance of Object.values(changed.taskInstances ?? {})) {
		if (!selectedPaths.has(instance.primary.filePath)) continue;
		instance.description += ' incremental benchmark change';
		affectedOperonIds.add(instance.operonId);
		const canonical = changed.tasks[instance.operonId];
		if (canonical) canonical.description = instance.description;
		const stat = changedStats.get(instance.primary.filePath);
		if (stat) changedStats.set(instance.primary.filePath, { ...stat, mtimeMs: stat.mtimeMs + 1 });
	}
	const input = {
		baseManifestPayload: base.manifestPayload,
		baseMembership: buildIndexV8BaselineMembership(data),
		indexData: changed,
		sourceStats: changedStats,
		sourceIndexes: buildIndexV8RamSourceIndexes(changed),
		dirtyBatch: {
			sequence: 1,
			dirtySourcePaths: selectedPaths,
			affectedOperonIds,
			forceFull: false,
		},
		committedAt: '2026-01-02T03:05:05.000Z',
		lastFullScanAt: FIXED_TIME,
		indexSemanticsSignature: 'incremental-benchmark-v1',
		coherenceBasis: 'verified-full-scan' as const,
	};
	const fullInput = {
		...input,
		dirtyBatch: { ...input.dirtyBatch, forceFull: true },
	};
	const incrementalProbe = await compileIndexV8Incremental(input);
	const fullProbe = await compileIndexV8Incremental(fullInput);
	const taskMap = new Map(Object.entries(changed.tasks));
	const secondary = new SecondaryIndexes();
	secondary.rebuild(taskMap);
	const incrementalParityProjection = projectIndexV8IncrementalParity(taskMap, secondary);
	const baseMembership = buildIndexV8BaselineMembership(data);
	const runPreparedCompile = async (forceFull: boolean): Promise<void> => {
		const sealed = sealIndexData(changed);
		const sealedTasks = new Map(Object.entries(sealed.tasks));
		const sealedProjection = projectIndexV8IncrementalParity(sealedTasks, secondary);
		const prepared = {
			...input,
			indexData: sealed,
			sourceStats: new Map(changedStats),
			sourceIndexes: buildIndexV8RamSourceIndexes(sealed),
			baseMembership,
			dirtyBatch: { ...input.dirtyBatch, forceFull },
		};
		const compiled = await compileIndexV8Incremental(prepared);
		if (forceFull) {
			await assertIndexV8Parity(sealed, {
				manifest: compiled.manifest,
				manifestPayload: compiled.manifestPayload,
				shards: [],
				shardPayloads: compiled.changedShardPayloads,
			}, Date.parse(input.committedAt), changedStats);
		} else {
			await assertIndexV8IncrementalParity(sealed, sealedProjection);
		}
	};
	const combinedPayloads = new Map(base.shardPayloads);
	for (const [shardId, payload] of incrementalProbe.changedShardPayloads) combinedPayloads.set(shardId, payload);
	let validatedSnapshot = true;
	try {
		await validateIndexV8Snapshot(incrementalProbe.manifestPayload, combinedPayloads);
	} catch {
		validatedSnapshot = false;
	}
	let incrementalCommitStore!: IndexV8Store;
	const timings = {
		incrementalEndToEndPreparationAndCompileMs: await measure(async () => { await runPreparedCompile(false); }),
		fullEndToEndPreparationAndCompileMs: await measure(async () => { await runPreparedCompile(true); }),
		incrementalCompileMs: await measure(async () => { await compileIndexV8Incremental(input); }),
		fullCompileMs: await measure(async () => { await compileIndexV8Incremental(fullInput); }),
		incrementalCompileAndParityMs: await measure(async () => {
			await compileIndexV8Incremental(input);
			await assertIndexV8IncrementalParity(changed, incrementalParityProjection);
		}),
		fullCompileAndParityMs: await measure(async () => {
			const compiled = await compileIndexV8Incremental(fullInput);
			await assertIndexV8Parity(changed, {
				manifest: compiled.manifest,
				manifestPayload: compiled.manifestPayload,
				shards: [],
				shardPayloads: compiled.changedShardPayloads,
			}, Date.parse(input.committedAt), changedStats);
		}),
		incrementalCommitMs: await measureWithSetup(
			async () => {
				incrementalCommitStore = new IndexV8Store(
					new IndexV8MemoryAdapter().asDataAdapter(),
					buildOperonStoragePaths('.obsidian', 'operon-incremental-benchmark').runtime.indexV8,
				);
				await incrementalCommitStore.commit(base);
			},
			async () => {
				await incrementalCommitStore.commitIncremental({
					expectedBaseSnapshotId: incrementalProbe.expectedBaseSnapshotId!,
					expectedBaseManifestPayload: incrementalProbe.expectedBaseManifestPayload!,
					manifestPayload: incrementalProbe.manifestPayload,
					changedShardPayloads: incrementalProbe.changedShardPayloads,
				});
			},
		),
	};
	const sourceIndexesHeap = measureIncrementalHelperHeapDelta(changed);
	return {
		label: `synthetic-${count}-incremental-${dirtySourceCount}-sources`,
		counts: {
			taskInstances: Object.keys(changed.taskInstances ?? {}).length,
			dirtySources: selectedPaths.size,
			dirtyShards: incrementalProbe.dirtyShardIds.length,
		},
		timings,
		comparison: {
			incrementalToFullEndToEndP95Ratio: round(
				timings.incrementalEndToEndPreparationAndCompileMs.p95
				/ timings.fullEndToEndPreparationAndCompileMs.p95,
			),
			incrementalToFullP95Ratio: round(timings.incrementalCompileMs.p95 / timings.fullCompileMs.p95),
			incrementalToFullCompileAndParityP95Ratio: round(
				timings.incrementalCompileAndParityMs.p95 / timings.fullCompileAndParityMs.p95,
			),
		},
		io: {
			shardsWritten: incrementalProbe.shardsWritten,
			shardsReused: incrementalProbe.shardsReused,
			bytesWritten: incrementalProbe.bytesWritten,
		},
		heapDeltaBytes: sourceIndexesHeap === null
			? { available: false, reason: 'Run Node with exposed GC for retained source-index delta' }
			: { available: true, sourceIndexesAndBaselineMembership: sourceIndexesHeap },
		integrity: {
			manifestMatchesFullCompile: incrementalProbe.manifestPayload === fullProbe.manifestPayload,
			shardPayloadsMatchFullCompile: fullProbe.manifest.shards.every(descriptor => (
				combinedPayloads.get(descriptor.shardId) === fullProbe.changedShardPayloads.get(descriptor.shardId)
			)),
			validatedSnapshot,
			singleSourceWritesOneShard: dirtySourceCount !== 1
				|| (incrementalProbe.shardsWritten === 1 && incrementalProbe.shardsReused === 31),
		},
	};
}

async function benchmarkShadowProfile(count: number): Promise<ShadowBenchmarkProfile> {
	const data = createSyntheticIndexData(count);
	const sourceStats = buildBenchmarkSourceStats(data);
	const snapshotInput = {
		committedAt: FIXED_TIME,
		lastFullScanAt: FIXED_TIME,
		coherenceBasis: 'verified-full-scan' as const,
		indexSemanticsSignature: 'shadow-benchmark-v1',
		sources: projectIndexDataToV8Sources(data, sourceStats),
		canonicalInstanceKeys: getIndexV8CanonicalInstanceKeys(data),
	};
	const snapshot = await buildIndexV8Snapshot(snapshotInput);
	const parity = await assertIndexV8Parity(data, snapshot, Date.parse(FIXED_TIME), sourceStats)
		.then(() => true, () => false);
	const commitPaths = buildOperonStoragePaths('.obsidian', `operon-shadow-benchmark-${count}`).runtime.indexV8;
	let commitStore = new IndexV8Store(new IndexV8MemoryAdapter().asDataAdapter(), commitPaths);
	const sealMs = await measure(() => { sealIndexData(data); });
	const compileMs = await measure(async () => { await buildIndexV8Snapshot(snapshotInput); });
	const parityMs = await measure(async () => {
		await assertIndexV8Parity(data, snapshot, Date.parse(FIXED_TIME), sourceStats);
	});
	const compileAndParityMs = await measure(async () => {
		const built = await buildIndexV8Snapshot(snapshotInput);
		await assertIndexV8Parity(data, built, Date.parse(FIXED_TIME), sourceStats);
	});
	const commitMs = await measureWithSetup(
		async () => {
			commitStore = new IndexV8Store(new IndexV8MemoryAdapter().asDataAdapter(), commitPaths);
		},
		async () => { await commitStore.commit(snapshot); },
	);
	return {
		label: `synthetic-${count}-shadow`,
		counts: {
			canonicalTasks: Object.keys(data.tasks).length,
			taskInstances: Object.keys(data.taskInstances ?? {}).length,
			sources: snapshot.manifest.totals.sourceCount,
		},
		timings: {
			sealMs,
			compileMs,
			parityMs,
			compileAndParityMs,
			commitMs,
		},
		integrity: {
			parity,
			manifestHas32Shards: snapshot.manifest.shards.length === 32,
		},
	};
}

async function benchmarkShadowBurst(): Promise<ShadowBurstProfile> {
	const data = createSyntheticIndexData(100);
	const sourceStats = buildBenchmarkSourceStats(data);
	let releaseFirst!: (result: IndexV8CommitResult) => void;
	const first = new Promise<IndexV8CommitResult>(resolvePromise => { releaseFirst = resolvePromise; });
	const committed: IndexV8SnapshotPayloads[] = [];
	const store: IndexV8ShadowStore = {
		load: async () => ({
			status: 'missing',
			metrics: { manifestBytes: 0, shardBytes: 0, shardsRead: 0, totalMs: 0 },
		}),
		commit: async snapshot => {
			committed.push(snapshot);
			if (committed.length === 1) return await first;
			return benchmarkCommitResult(snapshot);
		},
	};
	const scheduler: IndexV8ShadowScheduler = {
		now: () => Date.now(),
		setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
		clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
		delay: delayMs => new Promise(resolvePromise => globalThis.setTimeout(resolvePromise, delayMs)),
	};
	const writer = new IndexV8ShadowWriter(store, { scheduler });
	let maxPendingDepth = 0;
	const makeInput = (sequence: number): IndexV8ShadowInput => ({
		sequence,
		indexData: data,
		sourceStats,
		committedAt: new Date(Date.parse(FIXED_TIME) + sequence * 1_000).toISOString(),
		lastFullScanAt: FIXED_TIME,
		indexSemanticsSignature: 'shadow-benchmark-v1',
		coherenceBasis: 'verified-full-scan',
	});
	writer.enqueue(makeInput(1), { immediate: true });
	await waitForBenchmark(() => committed.length === 1);
	for (let sequence = 2; sequence <= 100; sequence++) {
		writer.enqueue(makeInput(sequence), { immediate: true });
		maxPendingDepth = Math.max(maxPendingDepth, writer.getStatus().pendingDepth);
	}
	releaseFirst(benchmarkCommitResult(committed[0]));
	await waitForBenchmark(() => committed.length === 2);
	await writer.drain();
	const status = writer.getStatus();
	const finalManifest = committed.length > 1 ? JSON.parse(committed.at(-1)!.manifestPayload) as { committedAt: string } : null;
	return {
		events: 100,
		attempted: status.attempted,
		succeeded: status.succeeded,
		coalesced: status.coalesced,
		maxPendingDepth,
		finalSequence: 100,
		finalManifestMatchesLatest: finalManifest?.committedAt === makeInput(100).committedAt,
	};
}

function benchmarkCommitResult(snapshot: IndexV8SnapshotPayloads): IndexV8CommitResult {
	const manifest = JSON.parse(snapshot.manifestPayload) as { snapshotId: string };
	return {
		status: 'committed',
		snapshotId: manifest.snapshotId,
		shardsWritten: 32,
		shardsReused: 0,
		bytesWritten: 0,
		manifestWritten: true,
		ioConcurrency: 4,
		metrics: {
			preflightMs: 0,
			transactionQueueWaitMs: 0,
			ensureFoldersMs: 0,
			shardPhaseMs: 0,
			shardExistsMs: 0,
			shardReadMs: 0,
			shardWriteMs: 0,
			shardVerifyMs: 0,
			manifestWriteMs: 0,
			manifestVerifyMs: 0,
			postflightMs: 0,
			totalMs: 0,
		},
	};
}

async function waitForBenchmark(predicate: () => boolean): Promise<void> {
	for (let count = 0; count < 100; count++) {
		if (predicate()) return;
		await new Promise(resolve => globalThis.setTimeout(resolve, 0));
	}
	throw new Error('Shadow benchmark timed out');
}

async function benchmarkSyncProfile(): Promise<SyncBenchmarkProfile> {
	const paths = buildOperonStoragePaths('.obsidian', 'operon-sync-benchmark').runtime.indexV8;
	const baseData = createSyntheticIndexData(5_000);
	const sourcePaths = [...new Set(Object.values(baseData.taskInstances ?? {}).map(instance => instance.primary.filePath))];
	const buildSnapshot = async (data: IndexData, committedAt: string) => await buildIndexV8Snapshot({
		committedAt,
		lastFullScanAt: FIXED_TIME,
		coherenceBasis: 'verified-full-scan',
		indexSemanticsSignature: 'sync-benchmark-v1',
		sources: projectIndexDataToV8Sources(data, buildBenchmarkSourceStats(data)),
		canonicalInstanceKeys: getIndexV8CanonicalInstanceKeys(data),
	});
	const base = await buildSnapshot(structuredClone(baseData), FIXED_TIME);
	const candidates = new Map<number, Awaited<ReturnType<typeof buildSnapshot>>>();
	for (const dirtyCount of [1, 10, 100]) {
		const changed = structuredClone(baseData);
		const dirty = new Set(sourcePaths.slice(0, dirtyCount));
		for (const instance of Object.values(changed.taskInstances ?? {})) {
			if (!dirty.has(instance.primary.filePath)) continue;
			instance.description += ` sync rebase ${dirtyCount}`;
			const canonical = changed.tasks[instance.operonId];
			if (canonical) canonical.description = instance.description;
		}
		candidates.set(dirtyCount, await buildSnapshot(
			changed,
			new Date(Date.parse(FIXED_TIME) + dirtyCount * 1_000).toISOString(),
		));
	}

	const scheduler = {
		now: () => 0,
		setTimeout: () => 0,
		clearTimeout: () => {},
		delay: async () => {},
	};
	const phaseCoordinator = new IndexV8PersistenceCoordinator({
		load: async () => ({ status: 'missing', metrics: { manifestBytes: 0, shardBytes: 0, shardsRead: 0, totalMs: 0 } }),
		commit: async () => { throw new Error('not used'); },
	}, { scheduler });
	const settlePhaseTransitionMs = await measure(() => {
		phaseCoordinator.setRuntimePhase('sync-settling');
		phaseCoordinator.setRuntimePhase('rebasing');
		phaseCoordinator.setRuntimePhase('idle');
	});

	const inventoryMs = {} as Record<'32' | '128' | '512', SampleStats>;
	let metadataInventoryReadsZeroShards = true;
	for (const orphanCount of [32, 128, 512] as const) {
		const adapter = new IndexV8MemoryAdapter();
		const store = new IndexV8Store(adapter.asDataAdapter(), paths);
		await store.commit({ ...base, expectedBaseMissing: true });
		for (let index = 0; index < orphanCount; index++) {
			const shardId = (index % 32).toString(16).padStart(2, '0');
			adapter.setFile(
				`${paths.shardsPath}/${shardId}-${index.toString(16).padStart(64, '0')}.json`,
				'{}',
				0,
			);
		}
		const operationStart = adapter.operations.length;
		inventoryMs[String(orphanCount) as '32' | '128' | '512'] = await measure(async () => { await store.inspect(); });
		metadataInventoryReadsZeroShards &&= adapter.operations.slice(operationStart).every(operation => (
			!operation.startsWith('readBinary:') && !operation.startsWith(`read:${paths.shardsPath}/`)
		));
	}

	let cleanupStore!: IndexV8Store;
	let cleanupPlan!: Awaited<ReturnType<IndexV8Store['planCleanup']>>;
	let cleanupAdapter!: IndexV8MemoryAdapter;
	const cleanupApplyMs = await measureWithSetup(async () => {
		cleanupAdapter = new IndexV8MemoryAdapter();
		cleanupStore = new IndexV8Store(cleanupAdapter.asDataAdapter(), paths);
		await cleanupStore.commit({ ...base, expectedBaseMissing: true });
		for (let index = 0; index < 40; index++) {
			const shardId = (index % 32).toString(16).padStart(2, '0');
			cleanupAdapter.setFile(
				`${paths.shardsPath}/${shardId}-${(index + 1_000).toString(16).padStart(64, '0')}.json`,
				'x'.repeat(1_000_000),
				0,
			);
		}
		cleanupPlan = await cleanupStore.planCleanup({ nowMs: 40 * 24 * 60 * 60 * 1_000 });
	}, async () => { await cleanupStore.applyCleanup(cleanupPlan); });
	const cleanupBytes = cleanupPlan.candidates.reduce((total, candidate) => total + candidate.sizeBytes, 0);
	const cleanupWithin32FilesAnd16Mb = cleanupPlan.candidates.length <= 32 && cleanupBytes <= 16_000_000;
	const staleAdapter = new IndexV8MemoryAdapter();
	const staleStore = new IndexV8Store(staleAdapter.asDataAdapter(), paths);
	await staleStore.commit({ ...base, expectedBaseMissing: true });
	staleAdapter.setFile(`${paths.shardsPath}/00-${'f'.repeat(64)}.json`, '{}', 0);
	const stalePlan = await staleStore.planCleanup({ nowMs: 40 * 24 * 60 * 60 * 1_000 });
	staleAdapter.setFile(paths.manifestPath, candidates.get(1)!.manifestPayload);
	const staleResult = await staleStore.applyCleanup(stalePlan);

	const rebaseCasMs = {} as Record<'1' | '10' | '100', SampleStats>;
	let rebaseCasUsesExpectedBase = true;
	for (const dirtyCount of [1, 10, 100] as const) {
		let store!: IndexV8Store;
		const candidate = candidates.get(dirtyCount)!;
		rebaseCasMs[String(dirtyCount) as '1' | '10' | '100'] = await measureWithSetup(async () => {
			store = new IndexV8Store(new IndexV8MemoryAdapter().asDataAdapter(), paths);
			await store.commit({ ...base, expectedBaseMissing: true });
		}, async () => {
			const result = await store.commit({
				...candidate,
				expectedBaseSnapshotId: base.manifest.snapshotId,
				expectedBaseManifestPayload: base.manifestPayload,
			});
			rebaseCasUsesExpectedBase &&= result.snapshotId === candidate.manifest.snapshotId;
		});
	}

	const fingerprintCandidate = candidates.get(1)!;
	const changedPayloads = new Map(fingerprintCandidate.manifest.shards
		.filter((descriptor, index) => descriptor.sha256 !== base.manifest.shards[index].sha256)
		.map(descriptor => [descriptor.shardId, fingerprintCandidate.shardPayloads.get(descriptor.shardId)!]));
	const reusedDescriptor = fingerprintCandidate.manifest.shards.find(descriptor => !changedPayloads.has(descriptor.shardId))!;
	let fingerprintStore!: IndexV8Store;
	let fingerprintMutationDetected = true;
	const fingerprintRevalidationMs = await measureWithSetup(async () => {
		const adapter = new IndexV8MemoryAdapter();
		fingerprintStore = new IndexV8Store(adapter.asDataAdapter(), paths);
		await fingerprintStore.commit({ ...base, expectedBaseMissing: true });
		const shardPath = `${paths.shardsPath}/${reusedDescriptor.shardId}-${reusedDescriptor.sha256}.json`;
		const payload = adapter.files.get(shardPath)!;
		adapter.setFile(shardPath, `${payload.slice(0, -1)}]`, (adapter.mtimes.get(shardPath) ?? 0) + 1);
	}, async () => {
		try {
			await fingerprintStore.commitIncremental({
				expectedBaseSnapshotId: base.manifest.snapshotId,
				expectedBaseManifestPayload: base.manifestPayload,
				manifestPayload: fingerprintCandidate.manifestPayload,
				changedShardPayloads: changedPayloads,
			});
			fingerprintMutationDetected = false;
		} catch (error) {
			if (!(error instanceof IndexV8StorageError) || error.code !== 'BASE_SNAPSHOT_CHANGED') throw error;
		}
	});
	const syncMaintenanceHeap = await measureSyncMaintenanceHeapDelta(base, paths);

	const emergencyCoordinator = new IndexV8PersistenceCoordinator({
		load: async () => ({ status: 'missing', metrics: { manifestBytes: 0, shardBytes: 0, shardsRead: 0, totalMs: 0 } }),
		commit: async () => { throw new Error('not used'); },
	}, { scheduler });
	emergencyCoordinator.setRuntimePhase('recovery-required');
	emergencyCoordinator.setRuntimePhase('idle');
	return {
		label: 'synthetic-5000-sync',
		timings: {
			settlePhaseTransitionMs,
			inventoryMs,
			cleanupApplyMs,
			rebaseCasMs,
			fingerprintRevalidationMs,
		},
		heapDeltaBytes: syncMaintenanceHeap === null
			? { available: false, reason: 'Run Node with exposed GC for retained Sync maintenance delta' }
			: { available: true, verifiedShardFingerprints: syncMaintenanceHeap },
		integrity: {
			metadataInventoryReadsZeroShards,
			cleanupWithin32FilesAnd16Mb,
			staleCleanupDeletesNothing: staleResult.status === 'stale' && staleResult.deletedCount === 0,
			rebaseCasUsesExpectedBase,
			fingerprintMutationDetected,
			emergencyPhaseIsTerminal: emergencyCoordinator.getRuntimePhase() === 'recovery-required',
		},
	};
}

async function benchmarkCutoverProfile(): Promise<CutoverBenchmarkProfile> {
	const adapter = new IndexV8MemoryAdapter();
	const runtimePaths = buildOperonStoragePaths('.obsidian', 'operon').runtime;
	const store = new IndexV8Store(adapter.asDataAdapter(), runtimePaths.indexV8, {
		legacyIndexPath: runtimePaths.indexPath,
		recoveryRequiredPath: runtimePaths.indexV8RecoveryRequiredPath,
	});
	const data = createSyntheticIndexData(5_000);
	const snapshot = await buildIndexV8Snapshot({
		committedAt: FIXED_TIME,
		lastFullScanAt: FIXED_TIME,
		coherenceBasis: 'verified-full-scan',
		indexSemanticsSignature: 'cutover-benchmark-v1',
		sources: createV8SourcesFromIndexData(data),
		canonicalInstanceKeys: getIndexV8CanonicalInstanceKeys(data),
	});
	await store.commit({ ...snapshot, expectedBaseMissing: true });
	adapter.setFile(runtimePaths.indexPath, '{"version":7}', Date.parse(FIXED_TIME));
	const app = {
		vault: {
			adapter: adapter.asDataAdapter(),
			getMarkdownFiles: () => [],
			getAbstractFileByPath: () => null,
		},
		metadataCache: { getFileCache: () => null },
	} as unknown as App;
	const storage = { getSettings: () => DEFAULT_SETTINGS };
	const indexer = new OperonIndexer(app, storage as never, null, store);
	adapter.operations.length = 0;
	const samples = await measure(async () => { await indexer.getIndexV8Diagnostics(); });
	const diagnostics = await indexer.getIndexV8Diagnostics();
	const plan = await store.planLegacyIndexV7Retirement();
	const softLimitMs = round(STAGE5_METADATA_DIAGNOSTICS_P95_MS * 1.1);
	const hardLimitMs = round(STAGE5_METADATA_DIAGNOSTICS_P95_MS * 1.2);
	return {
		label: 'synthetic-5000-cutover',
		timings: { metadataDiagnosticsMs: samples },
		counts: { activeShards: diagnostics.activeShardCount, taskInstances: 5_000 },
		performanceComparison: {
			stage5P95Ms: STAGE5_METADATA_DIAGNOSTICS_P95_MS,
			currentP95Ms: samples.p95,
			softLimitMs,
			hardLimitMs,
			softReviewRequired: samples.p95 > softLimitMs,
			hardGatePassed: samples.p95 <= hardLimitMs,
		},
		integrity: {
			metadataDiagnosticsReadZeroShardPayloads: !adapter.operations.some(operation => operation.startsWith('readBinary:')),
			legacyCacheDetectedWithoutRead: plan.legacyIndexFingerprint !== null
				&& !adapter.operations.some(operation => operation === `read:${runtimePaths.indexPath}`),
			retirementPlanSealed: plan.suppressedReasons.length === 0
				&& plan.activeSnapshotId === snapshot.manifest.snapshotId,
		},
	};
}

function evaluateHardGates(profiles: BenchmarkProfile[]): Array<{ id: string; passed: boolean }> {
	const liveProfile = profiles.find(profile => profile.label === 'live-v7-index');
	const synthetic25k = profiles.find(profile => profile.label === 'synthetic-25000');
	return [
		{
			id: 'all-profiles-report-32-shards',
			passed: profiles.every(profile => profile.counts.shards === 32),
		},
		{
			id: 'all-profiles-deterministic-and-parity-safe',
			passed: profiles.every(profile => Object.values(profile.integrity).every(Boolean)),
		},
		{
			id: 'all-profiles-max-to-average-at-most-3',
			passed: profiles.every(profile => profile.bytes.v8.maxToAverageRatio <= 3),
		},
		{
			id: 'all-profiles-v8-payload-smaller-than-v7',
			passed: profiles.every(profile => profile.bytes.v8ToV7Ratio < 0.75),
		},
		{
			id: 'synthetic-25k-max-shard-under-4mb',
			passed: synthetic25k?.bytes.v8.maxShardBytes !== undefined
				&& synthetic25k.bytes.v8.maxShardBytes < 4_000_000,
		},
		...(liveProfile ? [{
			id: 'live-5k-scale-max-shard-under-1mb',
			passed: liveProfile.bytes.v8.maxShardBytes < 1_000_000,
		}] : []),
	];
}

export async function runIndexBaseline(): Promise<Record<string, unknown>> {
	const profiles = [];
	for (const count of [1_000, 5_000, 10_000, 25_000]) {
		const data = createSyntheticIndexData(count);
		const firstTask = Object.values(data.tasks)[0];
		const firstInstance = Object.values(data.taskInstances ?? {})[0];
		if (firstTask) firstTask.fieldValues.pinned = 'true';
		if (firstInstance) firstInstance.fieldValues.pinned = 'true';
		profiles.push(await benchmarkProfile(`synthetic-${count}`, data));
	}
	const live = await loadLiveIndex();
	if (live.data) profiles.push(await benchmarkProfile('live-v7-index', live.data));
	const hardGates = evaluateHardGates(profiles);
	const storageRequested = process.argv.includes('--storage');
	const storageProfiles = storageRequested
		? [
			await benchmarkStorageProfile(5_000, 1),
			await benchmarkStorageProfile(5_000, 2),
			await benchmarkStorageProfile(5_000, 4),
			await benchmarkStorageProfile(5_000, 8),
			await benchmarkStorageProfile(25_000, 4),
		]
		: [];
	const storageHardGates = storageProfiles.map(profile => ({
		id: `${profile.label}-concurrency-${profile.ioConcurrency}-storage-integrity`,
		passed: Object.values(profile.integrity).every(Boolean),
	}));
	const shadowRequested = process.argv.includes('--shadow');
	const shadowProfiles = shadowRequested
		? [await benchmarkShadowProfile(5_000), await benchmarkShadowProfile(25_000)]
		: [];
	const shadowBurst = shadowRequested ? await benchmarkShadowBurst() : null;
	const shadowHardGates = shadowRequested ? [
		{
			id: 'shadow-profiles-parity-and-layout',
			passed: shadowProfiles.every(profile => Object.values(profile.integrity).every(Boolean)),
		},
		{
			id: 'shadow-burst-latest-wins',
			passed: shadowBurst !== null
				&& shadowBurst.maxPendingDepth <= 1
				&& shadowBurst.attempted === 2
				&& shadowBurst.succeeded === 2
				&& shadowBurst.coalesced === 98
				&& shadowBurst.finalManifestMatchesLatest,
		},
	] : [];
	const hydrationRequested = process.argv.includes('--hydration');
	const hydrationProfiles: HydrationBenchmarkProfile[] = [];
	if (hydrationRequested) {
		for (const count of [1_000, 5_000, 10_000, 25_000]) {
			hydrationProfiles.push(await benchmarkHydrationProfile(count));
		}
	}
	const hydrationHardGates = hydrationRequested ? [
		{
			id: 'hydration-profiles-cover-1k-5k-10k-25k',
			passed: hydrationProfiles.length === 4
				&& hydrationProfiles.map(profile => profile.counts.taskInstances).join(',') === '1000,5000,10000,25000',
		},
		{
			id: 'hydration-v8-loads-exactly-32-shards',
			passed: hydrationProfiles.every(profile => profile.counts.v8ShardsRead === 32),
		},
		{
			id: 'hydration-v7-v8-and-fallback-parity',
			passed: hydrationProfiles.every(profile => Object.values(profile.integrity).every(Boolean)),
		},
	] : [];
	const hydrationAdvisories = hydrationProfiles.map(profile => ({
		label: profile.label,
		v8LoadP95Within20PercentOfV7: profile.comparison.v8ToV7LoadP95Ratio <= 1.2,
		v8HeapP95Within20PercentOfV7: profile.comparison.v8ToV7HeapP95Ratio === null
			? null
			: profile.comparison.v8ToV7HeapP95Ratio <= 1.2,
	}));
	const incrementalRequested = process.argv.includes('--incremental');
	const incrementalProfiles: IncrementalBenchmarkProfile[] = [];
	if (incrementalRequested) {
		for (const count of [5_000, 25_000]) {
			for (const dirtySourceCount of [1, 10, 100]) {
				incrementalProfiles.push(await benchmarkIncrementalProfile(count, dirtySourceCount));
			}
		}
	}
	const incrementalHeapComparisons = incrementalRequested && hydrationRequested
		? incrementalProfiles
			.filter(profile => profile.counts.dirtySources === 1)
			.map(profile => {
				const hydration = hydrationProfiles.find(candidate => (
					candidate.counts.taskInstances === profile.counts.taskInstances
				));
				const baselineP95 = hydration?.heapDeltaBytes.v8SteadyState?.p95;
				const sourceIndexesP95 = profile.heapDeltaBytes.sourceIndexesAndBaselineMembership?.p95;
				const ratio = baselineP95 && sourceIndexesP95 !== undefined
					? round((baselineP95 + Math.max(0, sourceIndexesP95)) / baselineP95)
					: null;
				return {
					taskInstances: profile.counts.taskInstances,
					combinedToStage3HeapP95Ratio: ratio,
					softReview: ratio !== null && ratio > 1.1,
					hardGatePassed: ratio !== null && ratio <= 1.2,
				};
			})
		: [];
	const incrementalHardGates = incrementalRequested ? [
		{
			id: 'incremental-profiles-cover-5k-25k-and-1-10-100-sources',
			passed: incrementalProfiles.length === 6,
		},
		{
			id: 'incremental-compile-full-parity',
			passed: incrementalProfiles.every(profile => Object.values(profile.integrity).every(Boolean)),
		},
		{
			id: 'incremental-single-source-p95-not-slower-than-full',
			passed: incrementalProfiles
				.filter(profile => profile.counts.dirtySources === 1)
				.every(profile => profile.comparison.incrementalToFullP95Ratio <= 1
					&& profile.comparison.incrementalToFullCompileAndParityP95Ratio <= 1
					&& profile.comparison.incrementalToFullEndToEndP95Ratio <= 1),
		},
		...(hydrationRequested ? [{
			id: 'incremental-source-index-retained-heap-within-20-percent',
			passed: incrementalHeapComparisons.length === 2
				&& incrementalHeapComparisons.every(comparison => comparison.hardGatePassed),
		}] : []),
	] : [];
	const syncRequested = process.argv.includes('--sync');
	const syncProfile = syncRequested ? await benchmarkSyncProfile() : null;
	const syncIncrementalBaseline = incrementalProfiles.find(profile => (
		profile.counts.taskInstances === 5_000 && profile.counts.dirtySources === 1
	));
	const syncMaintenanceHeapP95 = syncProfile?.heapDeltaBytes.verifiedShardFingerprints?.p95;
	const syncStage4HeapP95 = syncIncrementalBaseline?.heapDeltaBytes.sourceIndexesAndBaselineMembership?.p95;
	const syncSingleSourceComparisons = incrementalProfiles
		.filter(profile => profile.counts.dirtySources === 1)
		.map(profile => {
			const stage4Ratio = STAGE4_SINGLE_SOURCE_END_TO_END_P95_RATIO.get(profile.counts.taskInstances);
			return {
				taskInstances: profile.counts.taskInstances,
				stage4P95Ratio: stage4Ratio ?? null,
				currentP95Ratio: profile.comparison.incrementalToFullEndToEndP95Ratio,
				hardLimit: stage4Ratio === undefined ? null : round(stage4Ratio * 1.2),
			};
		});
	const syncPerformanceComparison = syncProfile && syncIncrementalBaseline ? {
		singleSourceEndToEnd: syncSingleSourceComparisons,
		recoveryFullRebaseP95Ms: syncProfile.timings.rebaseCasMs['1'].p95,
		fingerprintToStage4SingleSourceP95Ratio: round(
			syncProfile.timings.fingerprintRevalidationMs.p95
				/ syncIncrementalBaseline.timings.incrementalCommitMs.p95,
		),
		retainedHeapToStage4P95Ratio: syncMaintenanceHeapP95 !== undefined && syncStage4HeapP95
			? round((syncStage4HeapP95 + Math.max(0, syncMaintenanceHeapP95)) / syncStage4HeapP95)
			: null,
	} : null;
	const syncHardGates = syncProfile ? [
		{
			id: 'sync-inventory-cleanup-rebase-and-fingerprint-integrity',
			passed: Object.values(syncProfile.integrity).every(Boolean),
		},
		{
			id: 'sync-single-source-end-to-end-p95-within-20-percent-of-stage4',
			passed: syncPerformanceComparison !== null
				&& syncPerformanceComparison.singleSourceEndToEnd.length === 2
				&& syncPerformanceComparison.singleSourceEndToEnd.every(comparison => (
					comparison.hardLimit !== null && comparison.currentP95Ratio <= comparison.hardLimit
				)),
		},
		{
			id: 'sync-retained-heap-within-20-percent-of-stage4',
			passed: syncPerformanceComparison !== null
				&& syncPerformanceComparison.retainedHeapToStage4P95Ratio !== null
				&& syncPerformanceComparison.retainedHeapToStage4P95Ratio <= 1.2,
		},
	] : [];
	const cutoverRequested = process.argv.includes('--cutover');
	const cutoverProfile = cutoverRequested ? await benchmarkCutoverProfile() : null;
	const cutoverHardGates = cutoverProfile ? [
		{
			id: 'cutover-metadata-diagnostics-and-retirement-integrity',
			passed: cutoverProfile.counts.activeShards === 32
				&& Object.values(cutoverProfile.integrity).every(Boolean),
		},
		{
			id: 'cutover-metadata-diagnostics-p95-within-20-percent-of-stage5',
			passed: cutoverProfile.performanceComparison.hardGatePassed,
		},
	] : [];
	const ok = [
		...hardGates,
		...storageHardGates,
		...shadowHardGates,
		...hydrationHardGates,
		...incrementalHardGates,
		...syncHardGates,
		...cutoverHardGates,
	]
		.every(gate => gate.passed);

	const report = {
		ok,
		contract: 'operon-index-v8-baseline-v3',
		warmupSamples: WARMUP_SAMPLES,
		measuredSamples: MEASURED_SAMPLES,
		wallClockHardGate: false,
		queryTimingUnit: 'microseconds-per-operation',
		queryIterationsPerSample: QUERY_ITERATIONS,
		sourceMetadataProjection: 'synthetic uses representative values; live V7 lacks source mtime and size so projection uses zero',
		live: {
			requested: process.argv.includes('--live'),
			included: live.data !== null,
			unavailableReason: live.reason,
		},
		storage: {
			requested: storageRequested,
			adapter: storageRequested ? 'node-temporary-directory' : null,
			defaultIoConcurrency: 4,
			wallClockHardGate: false,
			profiles: storageProfiles,
		},
		shadow: {
			requested: shadowRequested,
			wallClockHardGate: false,
			profiles: shadowProfiles,
			burst: shadowBurst,
		},
		hydration: {
			requested: hydrationRequested,
			adapter: hydrationRequested ? 'node-temporary-directory' : null,
			measurementOrder: 'unpaired-v7-then-v8',
			wallClockHardGate: false,
			performanceRegressionThreshold: 1.2,
			performanceRegressionIsInformational: true,
			profiles: hydrationProfiles,
			advisories: hydrationAdvisories,
		},
		incremental: {
			requested: incrementalRequested,
			wallClockHardGate: incrementalRequested,
			profiles: incrementalProfiles,
			heapComparisons: incrementalHeapComparisons,
		},
		sync: {
			requested: syncRequested,
			wallClockHardGate: syncRequested,
			performanceRegressionThresholds: { softReview: 1.1, hardFailure: 1.2 },
			performanceComparison: syncPerformanceComparison,
			profile: syncProfile,
		},
		cutover: {
			requested: cutoverRequested,
			wallClockHardGate: cutoverRequested,
			performanceRegressionThresholds: { softReview: 1.1, hardFailure: 1.2 },
			profile: cutoverProfile,
		},
		hardGates: [
			...hardGates,
			...storageHardGates,
			...shadowHardGates,
			...hydrationHardGates,
			...incrementalHardGates,
			...syncHardGates,
			...cutoverHardGates,
		],
		profiles,
	};
	if (!ok) process.exitCode = 1;
	return report;
}
