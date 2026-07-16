import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IndexData } from '../src/types/fields';
import { SecondaryIndexes } from '../src/indexer/secondary-indexes';
import {
	buildIndexV8Snapshot,
	deriveIndexV8InstanceKey,
	getIndexV8CanonicalInstanceKeys,
	hydrateValidatedIndexV8Snapshot,
	projectIndexDataToV8Sources,
	stableCompactStringify,
	type ValidatedIndexV8Snapshot,
} from '../src/indexer/persistence/index-v8-codec';
import { assertIndexV8Parity } from '../src/indexer/persistence/index-v8-parity';
import { IndexV8Store } from '../src/indexer/persistence/index-v8-store';
import { buildOperonStoragePaths } from '../src/storage/operon-storage-paths';
import { createSyntheticIndexData } from './index-v8-fixtures';
import { IndexV8NodeAdapter } from './index-v8-node-adapter';
import {
	HYDRATION_ACCEPTANCE_HEAP_SAMPLES,
	HYDRATION_ACCEPTANCE_PAIRED_SAMPLES,
	type AcceptanceRunResult,
	type AcceptanceSampleStats,
} from './index-v8-hydration-acceptance-classifier';

const TASK_INSTANCES = 1_000 as const;
const WARMUP_PAIRS = 10 as const;
const FIXED_TIME = '2026-01-02T03:04:05.000Z';
let resultSink = 0;

interface HydratedState {
	tasks: Map<string, IndexData['tasks'][string]>;
	taskInstances: Map<string, NonNullable<IndexData['taskInstances']>[string]>;
	secondary: SecondaryIndexes;
}

async function run(): Promise<AcceptanceRunResult> {
	if (typeof global.gc !== 'function') throw new Error('GC_UNAVAILABLE');
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'operon-index-v8-hydration-acceptance-'));
	try {
		const data = createAcceptanceIndexData();
		const sourceStats = buildSourceStats(data);
		const snapshot = await buildIndexV8Snapshot({
			committedAt: FIXED_TIME,
			lastFullScanAt: FIXED_TIME,
			coherenceBasis: 'verified-full-scan',
			indexSemanticsSignature: 'hydration-acceptance-v1',
			sources: projectIndexDataToV8Sources(data, sourceStats),
			canonicalInstanceKeys: getIndexV8CanonicalInstanceKeys(data),
		});
		await assertIndexV8Parity(data, snapshot, Date.parse(FIXED_TIME), sourceStats);
		const v7Path = path.join(temporaryRoot, 'index-v7.json');
		await writeFile(v7Path, JSON.stringify(data, null, '\t'), 'utf8');
		const adapter = new IndexV8NodeAdapter(temporaryRoot);
		const paths = buildOperonStoragePaths('.acceptance-config', 'operon-acceptance').runtime.indexV8;
		const store = new IndexV8Store(adapter.asDataAdapter(), paths, { ioConcurrency: 4 });
		await store.commit(snapshot);
		const v7Probe = await loadV7(v7Path);
		const loadedProbe = await store.load();
		if (loadedProbe.status !== 'loaded') throw new Error('V8_PROBE_NOT_LOADED');
		const v8Probe = hydrateLoadedV8(loadedProbe.validatedSnapshot);
		const integrity = {
			v8Loaded32Shards: loadedProbe.metrics.shardsRead === 32 && loadedProbe.manifest.shards.length === 32,
			taskInstanceCountParity: v7Probe.taskInstances.size === v8Probe.taskInstances.size,
			canonicalTaskCountParity: v7Probe.tasks.size === v8Probe.tasks.size,
			secondaryIndexParity: secondaryDigest(v7Probe.secondary) === secondaryDigest(v8Probe.secondary),
			taskSemanticParity: hydratedStateDigest(v7Probe) === hydratedStateDigest(v8Probe),
			duplicateCanonicalParity: duplicateDigest(v7Probe) === duplicateDigest(v8Probe),
			resultSinkAdvanced: false,
		};

		for (let index = 0; index < WARMUP_PAIRS; index++) {
			await measurePair(index % 2 === 0 ? 'ab' : 'ba', v7Path, store);
		}
		const v7Samples: number[] = [];
		const v8Samples: number[] = [];
		const abV7: number[] = [];
		const abV8: number[] = [];
		const abRatios: number[] = [];
		const baV7: number[] = [];
		const baV8: number[] = [];
		const baRatios: number[] = [];
		for (let index = 0; index < HYDRATION_ACCEPTANCE_PAIRED_SAMPLES; index++) {
			const order = index % 2 === 0 ? 'ab' : 'ba';
			const sample = await measurePair(order, v7Path, store);
			v7Samples.push(sample.v7Ms);
			v8Samples.push(sample.v8Ms);
			(order === 'ab' ? abV7 : baV7).push(sample.v7Ms);
			(order === 'ab' ? abV8 : baV8).push(sample.v8Ms);
			(order === 'ab' ? abRatios : baRatios).push(sample.v8Ms / sample.v7Ms);
		}

		const v7Heap: number[] = [];
		const v8Heap: number[] = [];
		for (let index = 0; index < HYDRATION_ACCEPTANCE_HEAP_SAMPLES; index++) {
			if (index % 2 === 0) {
				v7Heap.push(await measureSingleHeap(async () => await loadV7(v7Path)));
				v8Heap.push(await measureSingleHeap(async () => await loadV8(store)));
			} else {
				v8Heap.push(await measureSingleHeap(async () => await loadV8(store)));
				v7Heap.push(await measureSingleHeap(async () => await loadV7(v7Path)));
			}
		}
		const v7Stats = summarize(v7Samples);
		const v8Stats = summarize(v8Samples);
		const v7HeapStats = summarize(v7Heap);
		const v8HeapStats = summarize(v8Heap);
		integrity.resultSinkAdvanced = resultSink > 0;
		return {
			contract: 'operon-index-v8-hydration-acceptance-run-v1',
			environment: {
				node: process.version,
				platform: process.platform,
				arch: process.arch,
				diskContract: 'warm-page-cache-startup',
			},
			profile: {
				taskInstances: TASK_INSTANCES,
				sources: snapshot.manifest.totals.sourceCount,
				shards: 32,
			},
			ioConcurrency: 4,
			warmupPairs: WARMUP_PAIRS,
			pairedSamples: HYDRATION_ACCEPTANCE_PAIRED_SAMPLES,
			heapSamples: HYDRATION_ACCEPTANCE_HEAP_SAMPLES,
			timing: {
				v7Ms: v7Stats,
				v8Ms: v8Stats,
				v8ToV7P95Ratio: ratio(v8Stats.p95, v7Stats.p95),
				orderGroups: {
					ab: {
						samples: 30,
						v7Ms: summarize(abV7),
						v8Ms: summarize(abV8),
						pairedV8ToV7Ratio: summarize(abRatios),
					},
					ba: {
						samples: 30,
						v7Ms: summarize(baV7),
						v8Ms: summarize(baV8),
						pairedV8ToV7Ratio: summarize(baRatios),
					},
				},
			},
			heap: {
				v7Bytes: v7HeapStats,
				v8Bytes: v8HeapStats,
				v8ToV7P95Ratio: ratio(v8HeapStats.p95, v7HeapStats.p95),
			},
			integrity,
		};
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

function createAcceptanceIndexData(): IndexData {
	const data = createSyntheticIndexData(TASK_INSTANCES - 1);
	const original = Object.values(data.taskInstances ?? {})[0];
	if (!original) throw new Error('ACCEPTANCE_DUPLICATE_FIXTURE_MISSING');
	const duplicate = structuredClone(original);
	duplicate.primary.filePath = 'Synthetic/Acceptance Duplicate.md';
	duplicate.primary.lineNumber = 0;
	duplicate.instanceKey = deriveIndexV8InstanceKey(
		duplicate.primary.filePath,
		duplicate.primary.lineNumber,
		duplicate.primary.format,
	);
	data.taskInstances![duplicate.instanceKey] = duplicate;
	return data;
}

async function measurePair(
	order: 'ab' | 'ba',
	v7Path: string,
	store: IndexV8Store,
): Promise<{ v7Ms: number; v8Ms: number }> {
	let v7Ms = 0;
	let v8Ms = 0;
	const measureV7 = async () => { v7Ms = await measureLoad(async () => await loadV7(v7Path)); };
	const measureV8 = async () => { v8Ms = await measureLoad(async () => await loadV8(store)); };
	if (order === 'ab') {
		await measureV7();
		await measureV8();
	} else {
		await measureV8();
		await measureV7();
	}
	return { v7Ms, v8Ms };
}

async function measureLoad(action: () => Promise<HydratedState>): Promise<number> {
	global.gc?.();
	const startedAt = performance.now();
	const state = await action();
	const elapsed = performance.now() - startedAt;
	resultSink += state.tasks.size + state.taskInstances.size;
	return elapsed;
}

async function measureSingleHeap(action: () => Promise<HydratedState>): Promise<number> {
	const retainedBytes = await measureSingleHeapFrame(action);
	global.gc?.();
	return retainedBytes;
}

async function measureSingleHeapFrame(action: () => Promise<HydratedState>): Promise<number> {
	global.gc?.();
	const before = process.memoryUsage().heapUsed;
	const state = await action();
	global.gc?.();
	const retainedBytes = process.memoryUsage().heapUsed - before;
	resultSink += state.tasks.size + state.taskInstances.size;
	return retainedBytes;
}

async function loadV7(filePath: string): Promise<HydratedState> {
	return hydrateV7(JSON.parse(await readFile(filePath, 'utf8')) as IndexData);
}

async function loadV8(store: IndexV8Store): Promise<HydratedState> {
	const loaded = await store.load();
	if (loaded.status !== 'loaded') throw new Error(`V8_LOAD_${loaded.status.toUpperCase()}`);
	return hydrateLoadedV8(loaded.validatedSnapshot);
}

function hydrateLoadedV8(snapshot: ValidatedIndexV8Snapshot): HydratedState {
	const hydrated = hydrateValidatedIndexV8Snapshot(snapshot, Date.parse(FIXED_TIME));
	const secondary = new SecondaryIndexes();
	secondary.rebuild(hydrated.tasks);
	return { tasks: hydrated.tasks, taskInstances: hydrated.taskInstances, secondary };
}

function hydrateV7(data: IndexData): HydratedState {
	const taskInstances = new Map<string, NonNullable<IndexData['taskInstances']>[string]>();
	const byOperonId = new Map<string, string[]>();
	for (const [instanceKey, original] of Object.entries(data.taskInstances ?? {})) {
		const task = { ...original, fieldValues: { ...original.fieldValues }, instanceKey };
		delete task.fieldValues.pinned;
		taskInstances.set(instanceKey, task);
		const keys = byOperonId.get(task.operonId) ?? [];
		keys.push(instanceKey);
		byOperonId.set(task.operonId, keys);
	}
	const tasks = new Map<string, IndexData['tasks'][string]>();
	for (const [operonId, keys] of byOperonId) {
		const persisted = data.tasks[operonId];
		const canonicalKey = persisted
			? `${persisted.primary.format}:${persisted.primary.filePath}:${persisted.primary.lineNumber}`
			: [...keys].sort()[0];
		const instance = taskInstances.get(canonicalKey) ?? taskInstances.get(keys[0]);
		if (!instance) continue;
		const task = { ...instance };
		delete (task as { instanceKey?: string }).instanceKey;
		tasks.set(operonId, task);
	}
	const secondary = new SecondaryIndexes();
	secondary.rebuild(tasks);
	return { tasks, taskInstances, secondary };
}

function buildSourceStats(data: IndexData): Map<string, { mtimeMs: number; sizeBytes: number }> {
	const stats = new Map<string, { mtimeMs: number; sizeBytes: number }>();
	for (const task of Object.values(data.taskInstances ?? data.tasks)) {
		stats.set(task.primary.filePath, {
			mtimeMs: Date.parse(FIXED_TIME),
			sizeBytes: Math.max(1, task.primary.filePath.length * 10),
		});
	}
	return stats;
}

function secondaryDigest(indexes: SecondaryIndexes): string {
	const mapDigest = (map: Map<string, Set<string>>) => [...map]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, values]) => [key, [...values].sort()]);
	return stableCompactStringify({
		status: mapDigest(indexes.byStatus),
		due: [...indexes.byDue].sort((left, right) => (
			left.dateDue.localeCompare(right.dateDue) || left.operonId.localeCompare(right.operonId)
		)),
		parent: mapDigest(indexes.byParent),
		file: mapDigest(indexes.byFile),
		workflow: mapDigest(indexes.byWorkflowStatus),
		priority: mapDigest(indexes.byPriority),
	});
}

function hydratedStateDigest(state: HydratedState): string {
	return stableCompactStringify({
		tasks: [...state.tasks].sort(([left], [right]) => left.localeCompare(right)),
		taskInstances: [...state.taskInstances].sort(([left], [right]) => left.localeCompare(right)),
	});
}

function duplicateDigest(state: HydratedState): string {
	const grouped = new Map<string, string[]>();
	for (const [instanceKey, instance] of state.taskInstances) {
		const keys = grouped.get(instance.operonId) ?? [];
		keys.push(instanceKey);
		grouped.set(instance.operonId, keys);
	}
	return stableCompactStringify([...grouped]
		.filter(([, keys]) => keys.length > 1)
		.map(([operonId, keys]) => ({
			operonId,
			keys: keys.sort(),
			canonical: state.tasks.get(operonId)?.primary ?? null,
		}))
		.sort((left, right) => left.operonId.localeCompare(right.operonId)));
}

function summarize(samples: number[]): AcceptanceSampleStats {
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

function ratio(numerator: number, denominator: number): number {
	return round(numerator / denominator);
}

function round(value: number): number {
	return Math.round(value * 1_000) / 1_000;
}

async function main(): Promise<void> {
	try {
		process.stdout.write(`${JSON.stringify(await run())}\n`);
	} catch (error) {
		process.stdout.write(`${JSON.stringify({
			contract: 'operon-index-v8-hydration-acceptance-run-v1',
			error: { code: error instanceof Error ? error.message : 'UNKNOWN' },
		})}\n`);
		process.exitCode = 2;
	}
}

void main();
