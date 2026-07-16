import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import type { IndexData } from '../src/types/fields';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import { setOperonEnginePerfDebug } from '../src/core/engine-perf';
import { OperonIndexer } from '../src/indexer/indexer';
import {
	buildIndexV8Snapshot,
	decodeIndexV8Manifest,
	getIndexV8CanonicalInstanceKeys,
	projectIndexDataToV8Sources,
	validateIndexV8Snapshot,
	type IndexV8SourceStat,
} from '../src/indexer/persistence/index-v8-codec';
import { compareIndexV8Parity } from '../src/indexer/persistence/index-v8-parity';
import {
	IndexV8ShadowWriter,
	sealIndexData,
	type IndexV8ShadowInput,
	type IndexV8ShadowScheduler,
	type IndexV8ShadowStore,
} from '../src/indexer/persistence/index-v8-shadow-writer';
import {
	IndexV8StorageError,
	IndexV8Store,
	type IndexV8CommitResult,
	type IndexV8LoadResult,
	type IndexV8SnapshotPayloads,
} from '../src/indexer/persistence/index-v8-store';
import { buildOperonStoragePaths } from '../src/storage/operon-storage-paths';
import { createSyntheticIndexData } from './index-v8-fixtures';
import { IndexV8MemoryAdapter } from './index-v8-memory-adapter';

const BASE_TIME_MS = Date.parse('2026-01-02T03:04:05.000Z');
const FULL_SCAN_TIME = '2026-01-02T03:00:00.000Z';
const PRIVATE_DESCRIPTION = 'private shadow description';
const PRIVATE_PATH = 'Private/Shadow Fixture.md';
const PRIVATE_ID = 'private-shadow-id';
let assertions = 0;

function check(condition: unknown, message?: string): asserts condition {
	assert.ok(condition, message);
	assertions++;
}

function equal(actual: unknown, expected: unknown, message?: string): void {
	assert.equal(actual, expected, message);
	assertions++;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	if (message === undefined) assert.deepEqual(actual, expected);
	else assert.deepEqual(actual, expected, message);
	assertions++;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

class ManualShadowScheduler implements IndexV8ShadowScheduler {
	private currentMs = 0;
	private nextId = 1;
	private readonly timers = new Map<number, { dueMs: number; callback: () => void }>();

	now(): number { return this.currentMs; }

	setTimeout(callback: () => void, delayMs: number): unknown {
		const id = this.nextId++;
		this.timers.set(id, { dueMs: this.currentMs + Math.max(0, delayMs), callback });
		return id;
	}

	clearTimeout(handle: unknown): void {
		if (typeof handle === 'number') this.timers.delete(handle);
	}

	delay(delayMs: number): Promise<void> {
		return new Promise(resolve => { this.setTimeout(resolve, delayMs); });
	}

	get pendingTimerCount(): number { return this.timers.size; }

	async advanceBy(delayMs: number): Promise<void> {
		const targetMs = this.currentMs + delayMs;
		while (true) {
			const next = [...this.timers.entries()]
				.filter(([, timer]) => timer.dueMs <= targetMs)
				.sort((left, right) => left[1].dueMs - right[1].dueMs || left[0] - right[0])[0];
			if (!next) break;
			this.currentMs = next[1].dueMs;
			this.timers.delete(next[0]);
			next[1].callback();
			await settleMicrotasks();
		}
		this.currentMs = targetMs;
		await settleMicrotasks();
	}
}

class FakeShadowStore implements IndexV8ShadowStore {
	readonly commits: IndexV8SnapshotPayloads[] = [];
	readonly loads: IndexV8LoadResult[] = [];
	commitImpl: ((snapshot: IndexV8SnapshotPayloads, call: number) => Promise<IndexV8CommitResult>) | null = null;

	async load(): Promise<IndexV8LoadResult> {
		return this.loads.shift() ?? missingLoad();
	}

	async commit(snapshot: IndexV8SnapshotPayloads): Promise<IndexV8CommitResult> {
		this.commits.push(snapshot);
		if (this.commitImpl) return await this.commitImpl(snapshot, this.commits.length);
		return commitResult(snapshot);
	}
}

function missingLoad(): IndexV8LoadResult {
	return { status: 'missing', metrics: { manifestBytes: 0, shardBytes: 0, shardsRead: 0, totalMs: 0 } };
}

function commitResult(snapshot: IndexV8SnapshotPayloads): IndexV8CommitResult {
	const manifest = decodeIndexV8Manifest(snapshot.manifestPayload);
	return {
		status: 'committed',
		snapshotId: manifest.snapshotId,
		shardsWritten: 32,
		shardsReused: 0,
		bytesWritten: manifest.shards.reduce((total, descriptor) => total + descriptor.bytes, 0),
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

function makeInput(sequence: number, data: IndexData = createSyntheticIndexData(100)): IndexV8ShadowInput {
	const sourceStats = new Map<string, IndexV8SourceStat>();
	for (const task of Object.values(data.taskInstances ?? data.tasks)) {
		sourceStats.set(task.primary.filePath, {
			mtimeMs: BASE_TIME_MS,
			sizeBytes: Math.max(1, task.primary.filePath.length * 10),
		});
	}
	return {
		sequence,
		indexData: data,
		sourceStats,
		committedAt: new Date(BASE_TIME_MS + sequence * 1_000).toISOString(),
		lastFullScanAt: FULL_SCAN_TIME,
		indexSemanticsSignature: 'shadow-test-semantics-v1',
		coherenceBasis: 'verified-full-scan',
	};
}

async function buildSnapshot(data: IndexData, basis: IndexV8ShadowInput['coherenceBasis'] = 'verified-full-scan') {
	return await buildIndexV8Snapshot({
		committedAt: new Date(BASE_TIME_MS).toISOString(),
		lastFullScanAt: FULL_SCAN_TIME,
		coherenceBasis: basis,
		indexSemanticsSignature: 'shadow-test-semantics-v1',
		sources: projectIndexDataToV8Sources(data),
		canonicalInstanceKeys: getIndexV8CanonicalInstanceKeys(data),
	});
}

async function settleMicrotasks(): Promise<void> {
	for (let count = 0; count < 8; count++) await Promise.resolve();
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
	for (let count = 0; count < 100; count++) {
		if (predicate()) return;
		await settleMicrotasks();
		await new Promise(resolve => globalThis.setTimeout(resolve, 0));
	}
	throw new Error(`Timed out waiting for ${label}`);
}

async function testParityAndPrivacy(): Promise<void> {
	const data = createSyntheticIndexData(120);
	const snapshot = await buildSnapshot(data);
	const parity = await compareIndexV8Parity(data, snapshot, BASE_TIME_MS);
	check(parity.ok);
	if (parity.ok) equal(parity.checkedDimensions, 14);

	const ignored = structuredClone(data);
	for (const task of [...Object.values(ignored.tasks), ...Object.values(ignored.taskInstances ?? {})]) {
		task.tier = task.tier === 'cold' ? 'hot' : 'cold';
		task.fieldValues.pinned = 'true';
	}
	check((await compareIndexV8Parity(ignored, snapshot, BASE_TIME_MS)).ok, 'tier and pinned must not affect parity');

	const privateData = structuredClone(data);
	const firstTask = Object.values(privateData.tasks)[0];
	const firstInstance = Object.values(privateData.taskInstances ?? {})[0];
	firstTask.description = PRIVATE_DESCRIPTION;
	firstTask.operonId = PRIVATE_ID;
	firstTask.primary.filePath = PRIVATE_PATH;
	firstInstance.description = PRIVATE_DESCRIPTION;
	firstInstance.operonId = PRIVATE_ID;
	firstInstance.primary.filePath = PRIVATE_PATH;
	const mismatch = await compareIndexV8Parity(privateData, snapshot, BASE_TIME_MS);
	check(!mismatch.ok);
	if (!mismatch.ok) {
		check(mismatch.mismatches.length > 0);
		const serialized = JSON.stringify(mismatch);
		check(!serialized.includes(PRIVATE_DESCRIPTION));
		check(!serialized.includes(PRIVATE_PATH));
		check(!serialized.includes(PRIVATE_ID));
		check(mismatch.mismatches.every(item => /^[a-f0-9]{64}$/u.test(item.leftDigest)));
		check(mismatch.mismatches.every(item => /^[a-f0-9]{64}$/u.test(item.rightDigest)));
	}

	const sourceInput = makeInput(1, data);
	const metadataSnapshot = await buildIndexV8Snapshot({
		committedAt: sourceInput.committedAt,
		lastFullScanAt: sourceInput.lastFullScanAt,
		coherenceBasis: sourceInput.coherenceBasis,
		indexSemanticsSignature: sourceInput.indexSemanticsSignature,
		sources: projectIndexDataToV8Sources(data, sourceInput.sourceStats),
		canonicalInstanceKeys: getIndexV8CanonicalInstanceKeys(data),
	});
	check((await compareIndexV8Parity(data, metadataSnapshot, BASE_TIME_MS, sourceInput.sourceStats)).ok, 'metadata parity');
	const changedStats = new Map(sourceInput.sourceStats);
	const [changedPath, changedStat] = changedStats.entries().next().value!;
	changedStats.set(changedPath, { ...changedStat, sizeBytes: changedStat.sizeBytes + 1 });
	const metadataMismatch = await compareIndexV8Parity(data, metadataSnapshot, BASE_TIME_MS, changedStats);
	check(!metadataMismatch.ok, 'metadata mismatch');
	if (!metadataMismatch.ok) {
		deepEqual(metadataMismatch.mismatches.map(item => item.dimension), ['source-metadata']);
	}

	const secondaryCases: Array<{
		dimension: 'secondary-by-status' | 'secondary-by-due' | 'secondary-by-parent'
			| 'secondary-by-file' | 'secondary-by-workflow-status' | 'secondary-by-priority';
		mutate(task: IndexData['tasks'][string]): void;
	}> = [
		{ dimension: 'secondary-by-status', mutate: task => { task.checkbox = task.checkbox === 'open' ? 'done' : 'open'; } },
		{ dimension: 'secondary-by-due', mutate: task => { task.fieldValues.dateDue = '2099-12-31'; } },
		{ dimension: 'secondary-by-parent', mutate: task => { task.fieldValues.parentTask = 'fixture-parent'; } },
		{ dimension: 'secondary-by-file', mutate: task => { task.primary.filePath = 'Changed/Fixture.md'; } },
		{ dimension: 'secondary-by-workflow-status', mutate: task => { task.fieldValues.status = 'Fixture.Changed'; } },
		{ dimension: 'secondary-by-priority', mutate: task => { task.fieldValues.priority = 'Fixture-Priority'; } },
	];
	for (const testCase of secondaryCases) {
		const changed = structuredClone(data);
		const first = Object.values(changed.tasks)[0];
		const matchingInstance = Object.values(changed.taskInstances ?? {})
			.find(instance => instance.operonId === first.operonId)!;
		testCase.mutate(first);
		testCase.mutate(matchingInstance);
		const result = await compareIndexV8Parity(changed, snapshot, BASE_TIME_MS);
		check(!result.ok, `Expected ${testCase.dimension} mismatch`);
		if (!result.ok) check(
			result.mismatches.some(item => item.dimension === testCase.dimension),
			`Missing ${testCase.dimension} in parity result`,
		);
	}

	const duplicateData = structuredClone(createSyntheticIndexData(2));
	const original = Object.values(duplicateData.taskInstances ?? {})[0];
	const duplicate = structuredClone(original);
	duplicate.primary.filePath = 'Duplicate/Fixture.md';
	duplicate.primary.lineNumber += 10;
	duplicate.instanceKey = `${duplicate.primary.filePath}:${duplicate.primary.lineNumber}:${duplicate.primary.format}`;
	duplicateData.taskInstances![duplicate.instanceKey] = duplicate;
	const duplicateSnapshot = await buildSnapshot(duplicateData);
	check((await compareIndexV8Parity(duplicateData, duplicateSnapshot, BASE_TIME_MS)).ok, 'duplicate parity');
	const changedCanonical = structuredClone(duplicateData);
	changedCanonical.tasks[original.operonId].primary = { ...duplicate.primary };
	const canonicalMismatch = await compareIndexV8Parity(changedCanonical, duplicateSnapshot, BASE_TIME_MS);
	check(!canonicalMismatch.ok, 'canonical mismatch');
	if (!canonicalMismatch.ok) {
		check(canonicalMismatch.mismatches.some(item => item.dimension === 'canonical-selections'));
	}
}

async function testIndexerV8PrimaryOrderingAndSealedSnapshot(): Promise<void> {
	const data = createSyntheticIndexData(2);
	const order: string[] = [];
	const shadowInputs: IndexV8ShadowInput[] = [];
	const dirtyBatches: Array<{
		sequence: number;
		dirtySourcePaths: ReadonlySet<string>;
		affectedOperonIds: ReadonlySet<string>;
		forceFull: boolean;
	}> = [];
	let failPrimary = false;
	let saveCount = 0;
	let recoveryMarkerCount = 0;
	const storage = {
		getSettings: () => DEFAULT_SETTINGS,
		saveIndex: async () => {
			order.push('v7-start');
			saveCount += 1;
			order.push('v7-success');
			return { jsonBytes: 1, stringifyMs: 0, writeMs: 0, queueWaitMs: 0, totalMs: 0 };
		},
		markIndexV8RecoveryRequired: async () => { recoveryMarkerCount += 1; },
	};
	const shadow = {
		persistPrimary: async (input: IndexV8ShadowInput, dirty: typeof dirtyBatches[number]) => {
			order.push('v8-primary');
			if (failPrimary) throw new IndexV8StorageError('INVALID_SNAPSHOT', 'fixture primary failure');
			shadowInputs.push(input);
			dirtyBatches.push({
				...dirty,
				dirtySourcePaths: new Set(dirty.dirtySourcePaths),
				affectedOperonIds: new Set(dirty.affectedOperonIds),
			});
			return {
				status: 'committed' as const,
				mode: dirty.forceFull ? 'full' as const : 'incremental' as const,
				sequence: input.sequence,
				snapshotId: `fixture-${input.sequence}`,
				committedAt: input.committedAt,
				dirtyShardCount: dirty.dirtySourcePaths.size,
				shardsWritten: dirty.dirtySourcePaths.size,
				shardsReused: 32 - dirty.dirtySourcePaths.size,
				bytesWritten: 1,
			};
		},
		disable: (code: string) => { order.push(`v8-disable:${code}`); },
	};
	const app = {
		vault: { getAbstractFileByPath: () => null },
	} as unknown as App;
	const indexer = new OperonIndexer(
		app,
		storage as never,
		shadow as unknown as IndexV8ShadowWriter,
	);
	const mutable = indexer as unknown as {
		tasks: Map<string, IndexData['tasks'][string]>;
		taskInstances: Map<string, NonNullable<IndexData['taskInstances']>[string]>;
		fileMtimes: Map<string, number>;
		fileSizes: Map<string, number>;
		coherentWorkflowStatusSemanticsSignature: string;
		lastFullScanAt: string;
		persistIndex(options: {
			immediate?: boolean;
			dirtySourcePaths?: Iterable<string>;
			affectedOperonIds?: Iterable<string>;
			forceFull?: boolean;
			writeV7Checkpoint?: boolean;
		}): Promise<void>;
		flushPendingPersist(): Promise<void>;
	};
	mutable.tasks = new Map(Object.entries(data.tasks));
	mutable.taskInstances = new Map(Object.entries(data.taskInstances ?? {}));
	mutable.fileMtimes = new Map(Array.from(mutable.taskInstances.values(), task => [task.primary.filePath, 123]));
	mutable.fileSizes = new Map(Array.from(mutable.taskInstances.values(), task => [task.primary.filePath, 456]));
	mutable.coherentWorkflowStatusSemanticsSignature = data.workflowStatusSemanticsSignature;
	mutable.lastFullScanAt = FULL_SCAN_TIME;

	await mutable.persistIndex({ immediate: true });
	deepEqual(order, ['v8-primary']);
	equal(saveCount, 0, 'healthy V8 primary persistence must not write V7');
	equal(shadowInputs.length, 1);
	const sealedDescription = Object.values(shadowInputs[0].indexData.taskInstances ?? {})[0].description;
	Object.values(data.taskInstances ?? {})[0].description = 'mutated live state';
	equal(Object.values(shadowInputs[0].indexData.taskInstances ?? {})[0].description, sealedDescription);
	check(Array.from(shadowInputs[0].sourceStats.values()).every(stat => stat.mtimeMs === 123 && stat.sizeBytes === 456));

	order.length = 0;
	await mutable.persistIndex({ dirtySourcePaths: ['A.md'], affectedOperonIds: ['a'] });
	await mutable.persistIndex({ dirtySourcePaths: ['B.md'], affectedOperonIds: ['b'] });
	await mutable.flushPendingPersist();
	deepEqual(order, ['v8-primary']);
	equal(dirtyBatches.length, 2);
	deepEqual([...dirtyBatches[1].dirtySourcePaths].sort(), ['A.md', 'B.md']);
	deepEqual([...dirtyBatches[1].affectedOperonIds].sort(), ['a', 'b']);

	order.length = 0;
	const primaryBeforeBurst = shadowInputs.length;
	for (let index = 0; index < 1_000; index++) {
		await mutable.persistIndex({
			dirtySourcePaths: [`Burst-${index}.md`],
			affectedOperonIds: [`burst-${index}`],
		});
	}
	equal(shadowInputs.length, primaryBeforeBurst, 'pending burst must not start more than one persistence job');
	await mutable.flushPendingPersist();
	equal(shadowInputs.length, primaryBeforeBurst + 1);
	equal(dirtyBatches.at(-1)?.dirtySourcePaths.size, 1_000);
	equal(dirtyBatches.at(-1)?.affectedOperonIds.size, 1_000);

	order.length = 0;
	await mutable.persistIndex({ immediate: true, forceFull: true, writeV7Checkpoint: true });
	deepEqual(order, ['v8-primary']);
	equal(dirtyBatches.at(-1)?.forceFull, true);
	equal(saveCount, 0, 'verified full persistence must keep the V7 compatibility checkpoint frozen');

	order.length = 0;
	failPrimary = true;
	await mutable.persistIndex({ immediate: true, dirtySourcePaths: ['Failure.md'] });
	deepEqual(order, [
		'v8-primary',
		'v8-disable:PRIMARY_INVALID_SNAPSHOT',
	]);
	equal(saveCount, 0, 'non-retryable V8 failure must not create a legacy V7 snapshot');
	equal(recoveryMarkerCount, 1, 'non-retryable V8 failure must create one durable recovery marker');
}

async function testSchedulingAndSealing(): Promise<void> {
	const scheduler = new ManualShadowScheduler();
	const store = new FakeShadowStore();
	const writer = new IndexV8ShadowWriter(store, { scheduler });
	const input = makeInput(1);
	const originalDescription = Object.values(input.indexData.tasks)[0].description;
	writer.enqueue(input);
	equal(writer.getStatus().phase, 'scheduled');
	await scheduler.advanceBy(1_999);
	equal(store.commits.length, 0);
	Object.values(input.indexData.tasks)[0].description = 'mutated after enqueue';
	Object.values(input.indexData.taskInstances ?? {})[0].description = 'mutated after enqueue';
	input.sourceStats.values().next().value!.mtimeMs = 999;
	await scheduler.advanceBy(1);
	await writer.drain();
	equal(store.commits.length, 1);
	const committed = store.commits[0];
	const manifest = decodeIndexV8Manifest(committed.manifestPayload);
	const committedSources = manifest.shards.flatMap(descriptor => {
		const shard = JSON.parse(committed.shardPayloads.get(descriptor.shardId)!) as {
			sources: Array<{ instances: Array<{ description: string }>; mtimeMs: number }>;
		};
		return shard.sources;
	});
	check(committedSources.some(source => source.instances.some(task => task.description === originalDescription)));
	check(committedSources.every(source => source.mtimeMs !== 999));
	equal(writer.getStatus().succeeded, 1);
	equal(writer.getStatus().phase, 'idle');

	const disabledStore = new FakeShadowStore();
	const disabled = new IndexV8ShadowWriter(disabledStore, { enabled: false, scheduler: new ManualShadowScheduler() });
	disabled.enqueue(makeInput(1), { immediate: true });
	await disabled.drain();
	equal(disabledStore.commits.length, 0);
	equal(disabled.getStatus().phase, 'disabled');

	const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
	Object.defineProperty(globalThis, 'window', { configurable: true, value: {
		operonIndexV8ShadowEnabled: false,
		crypto: globalThis.crypto,
	} as unknown as Window });
	try {
		const killSwitchStore = new FakeShadowStore();
		const killSwitch = new IndexV8ShadowWriter(killSwitchStore, { scheduler: new ManualShadowScheduler() });
		killSwitch.enqueue(makeInput(1), { immediate: true });
		await killSwitch.drain();
		equal(killSwitchStore.commits.length, 0);
		equal(killSwitch.getStatus().enabled, false);
	} finally {
		if (originalWindowDescriptor) Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
		else Reflect.deleteProperty(globalThis, 'window');
	}
}

async function testLatestWinsAndRetry(): Promise<void> {
	const reverseScheduler = new ManualShadowScheduler();
	const reverseStore = new FakeShadowStore();
	const reverseWriter = new IndexV8ShadowWriter(reverseStore, { scheduler: reverseScheduler });
	reverseWriter.enqueue(makeInput(2));
	reverseWriter.enqueue(makeInput(1));
	await reverseScheduler.advanceBy(2_000);
	await reverseWriter.drain();
	equal(reverseStore.commits.length, 1);
	equal(decodeIndexV8Manifest(reverseStore.commits[0].manifestPayload).committedAt, makeInput(2).committedAt);

	const scheduler = new ManualShadowScheduler();
	const store = new FakeShadowStore();
	const first = deferred<IndexV8CommitResult>();
	store.commitImpl = async (snapshot, call) => call === 1 ? await first.promise : commitResult(snapshot);
	const writer = new IndexV8ShadowWriter(store, { scheduler });
	writer.enqueue(makeInput(1), { immediate: true });
	await waitFor(() => store.commits.length === 1, 'first shadow commit');
	for (let sequence = 2; sequence <= 100; sequence++) writer.enqueue(makeInput(sequence), { immediate: true });
	equal(writer.getStatus().pendingDepth, 1);
	equal(writer.getStatus().coalesced, 98);
	first.resolve(commitResult(store.commits[0]));
	await waitFor(() => store.commits.length === 2, 'latest shadow commit');
	await writer.drain();
	const finalManifest = decodeIndexV8Manifest(store.commits[1].manifestPayload);
	equal(finalManifest.committedAt, makeInput(100).committedAt);
	equal(writer.getStatus().attempted, 2);
	equal(writer.getStatus().succeeded, 2);
	equal(writer.getStatus().pendingDepth, 0);

	const retryScheduler = new ManualShadowScheduler();
	const retryStore = new FakeShadowStore();
	retryStore.commitImpl = async (snapshot, call) => {
		if (call === 1) {
			const error = new Error('transient I/O');
			error.name = 'IndexV8TransientIoError';
			throw error;
		}
		return commitResult(snapshot);
	};
	const retryWriter = new IndexV8ShadowWriter(retryStore, { scheduler: retryScheduler });
	retryWriter.enqueue(makeInput(1), { immediate: true });
	await waitFor(() => retryStore.commits.length === 1 && retryWriter.getStatus().phase === 'retrying', 'retry schedule');
	await retryScheduler.advanceBy(4_999);
	equal(retryStore.commits.length, 1);
	await retryScheduler.advanceBy(1);
	await retryWriter.drain();
	equal(retryStore.commits.length, 2);
	equal(retryWriter.getStatus().attempted, 2);
	equal(retryWriter.getStatus().failed, 1);
	equal(retryWriter.getStatus().succeeded, 1);
}

async function testParityBlocksCommitAndMetadataGate(): Promise<void> {
	const parityStore = new FakeShadowStore();
	const parityWriter = new IndexV8ShadowWriter(parityStore, { scheduler: new ManualShadowScheduler() });
	const inconsistent = createSyntheticIndexData(2);
	const [taskMapKey, task] = Object.entries(inconsistent.tasks)[0];
	task.operonId = `${taskMapKey}-inconsistent`;
	parityWriter.enqueue(makeInput(1, inconsistent), { immediate: true });
	await parityWriter.drain();
	equal(parityStore.commits.length, 0);
	equal(parityWriter.getStatus().lastErrorCode, 'PARITY_MISMATCH');

	const metadataStore = new FakeShadowStore();
	const metadataWriter = new IndexV8ShadowWriter(metadataStore, { scheduler: new ManualShadowScheduler() });
	const missingMetadata = makeInput(1);
	const firstPath = missingMetadata.sourceStats.keys().next().value!;
	const incompleteStats = new Map(missingMetadata.sourceStats);
	incompleteStats.set(firstPath, { mtimeMs: 0, sizeBytes: 0 });
	missingMetadata.sourceStats = incompleteStats;
	metadataWriter.enqueue(missingMetadata, { immediate: true });
	await metadataWriter.drain();
	equal(metadataStore.commits.length, 0);
	equal(metadataWriter.getStatus().phase, 'disabled');
	equal(metadataWriter.getStatus().lastErrorCode, 'CODEC_INVALID');

	const seedStore = new FakeShadowStore();
	const seedWriter = new IndexV8ShadowWriter(seedStore, { scheduler: new ManualShadowScheduler() });
	const compatibilitySeed = makeInput(1);
	compatibilitySeed.coherenceBasis = 'v7-startup-seed';
	compatibilitySeed.sourceStats = incompleteStats;
	seedWriter.enqueue(compatibilitySeed, { immediate: true });
	await seedWriter.drain();
	equal(seedStore.commits.length, 1);
}

async function testIndexerStartupSeedAndUnloadDrain(): Promise<void> {
	const data = createSyntheticIndexData(2);
	let saveCount = 0;
	let primaryCount = 0;
	let drainCount = 0;
	let startupDecision: 'rewrite' | 'current' | 'deferred' = 'rewrite';
	const storage = {
		getSettings: () => DEFAULT_SETTINGS,
		saveIndex: async () => {
			saveCount += 1;
			return { jsonBytes: 1, stringifyMs: 0, writeMs: 0, queueWaitMs: 0, totalMs: 0 };
		},
	};
	const shadow = {
		persistPrimary: async (input: IndexV8ShadowInput) => {
			primaryCount += 1;
			return {
				status: 'committed' as const,
				mode: 'full' as const,
				sequence: input.sequence,
				snapshotId: `fixture-${input.sequence}`,
				committedAt: input.committedAt,
				dirtyShardCount: 32,
				shardsWritten: 32,
				shardsReused: 0,
				bytesWritten: 1,
			};
		},
		disable: () => {},
		drain: async () => { drainCount += 1; },
		inspectStartupSeed: async (committedAt: string, semantics: string) => {
			if (startupDecision === 'rewrite') return { action: 'rewrite' as const };
			if (startupDecision === 'deferred') return { action: 'deferred' as const, code: 'INCOMPLETE' };
			return {
				action: 'current' as const,
				manifest: {
					committedAt,
					indexSemanticsSignature: semantics,
					coherenceBasis: 'verified-full-scan' as const,
					lastFullScanAt: FULL_SCAN_TIME,
				},
			};
		},
	};
	const indexer = new OperonIndexer(
		{ vault: { getAbstractFileByPath: () => null } } as unknown as App,
		storage as never,
		shadow as unknown as IndexV8ShadowWriter,
	);
	const mutable = indexer as unknown as {
		tasks: Map<string, IndexData['tasks'][string]>;
		taskInstances: Map<string, NonNullable<IndexData['taskInstances']>[string]>;
		fileMtimes: Map<string, number>;
		fileSizes: Map<string, number>;
		coherentWorkflowStatusSemanticsSignature: string;
		coherentIndexV8SemanticsSignature: string;
		lastDurableCommittedAt: string;
		lastFullScanAt: string;
	};
	mutable.tasks = new Map(Object.entries(data.tasks));
	mutable.taskInstances = new Map(Object.entries(data.taskInstances ?? {}));
	mutable.fileMtimes = new Map(Array.from(mutable.taskInstances.values(), task => [task.primary.filePath, 123]));
	mutable.fileSizes = new Map(Array.from(mutable.taskInstances.values(), task => [task.primary.filePath, 456]));
	mutable.coherentWorkflowStatusSemanticsSignature = data.workflowStatusSemanticsSignature;
	mutable.coherentIndexV8SemanticsSignature = 'fixture-semantics';
	mutable.lastDurableCommittedAt = new Date(BASE_TIME_MS).toISOString();
	mutable.lastFullScanAt = FULL_SCAN_TIME;

	await indexer.ensureV8ShadowSeed();
	equal(saveCount, 0);
	equal(primaryCount, 1);

	startupDecision = 'current';
	await indexer.ensureV8ShadowSeed();
	equal(saveCount, 0);
	equal(primaryCount, 1);

	startupDecision = 'deferred';
	await indexer.ensureV8ShadowSeed();
	equal(saveCount, 0);
	equal(primaryCount, 1);

	const unloadIndexer = new OperonIndexer(
		{ vault: { getAbstractFileByPath: () => null } } as unknown as App,
		storage as never,
		shadow as unknown as IndexV8ShadowWriter,
	);
	const unloadMutable = unloadIndexer as unknown as typeof mutable & {
		persistIndex(options?: object): Promise<void>;
	};
	unloadMutable.tasks = new Map(Object.entries(data.tasks));
	unloadMutable.taskInstances = new Map(Object.entries(data.taskInstances ?? {}));
	unloadMutable.fileMtimes = new Map(Array.from(unloadMutable.taskInstances.values(), task => [task.primary.filePath, 123]));
	unloadMutable.fileSizes = new Map(Array.from(unloadMutable.taskInstances.values(), task => [task.primary.filePath, 456]));
	unloadMutable.coherentWorkflowStatusSemanticsSignature = data.workflowStatusSemanticsSignature;
	unloadMutable.coherentIndexV8SemanticsSignature = 'fixture-semantics';
	unloadMutable.lastFullScanAt = FULL_SCAN_TIME;
	await unloadMutable.persistIndex();
	await unloadIndexer.prepareForUnload();
	equal(primaryCount, 2);
	equal(saveCount, 0, 'healthy V8 clean unload must keep the V7 compatibility checkpoint frozen');
	check(drainCount >= 1);
}

async function testStartupClassification(): Promise<void> {
	const scheduler = new ManualShadowScheduler();
	const missingWriter = new IndexV8ShadowWriter(new FakeShadowStore(), { scheduler });
	deepEqual(await missingWriter.inspectStartupSeed('2026-01-02T00:00:00.000Z', 'semantics'), { action: 'rewrite' });

	const data = createSyntheticIndexData(10);
	const snapshot = await buildSnapshot(data, 'v7-startup-seed');
	const validatedSnapshot = await validateIndexV8Snapshot(snapshot.manifestPayload, snapshot.shardPayloads);
	const loaded: IndexV8LoadResult = {
		status: 'loaded',
		manifest: snapshot.manifest,
		manifestPayload: snapshot.manifestPayload,
		shards: snapshot.shards,
		validatedSnapshot,
		metrics: { manifestBytes: 0, shardBytes: 0, shardsRead: 32, totalMs: 0 },
	};
	const currentStore = new FakeShadowStore();
	currentStore.loads.push(loaded);
	const current = await new IndexV8ShadowWriter(currentStore, { scheduler: new ManualShadowScheduler() })
		.inspectStartupSeed(snapshot.manifest.committedAt, snapshot.manifest.indexSemanticsSignature);
	equal(current.action, 'current');

	const retryStore = new FakeShadowStore();
	retryStore.loads.push(
		{
			status: 'incomplete',
			retryable: true,
			snapshotId: snapshot.manifest.snapshotId,
			manifest: snapshot.manifest,
			manifestPayload: snapshot.manifestPayload,
			missingShardIds: ['00'],
			metrics: { manifestBytes: 0, shardBytes: 0, shardsRead: 31, totalMs: 0 },
		},
		missingLoad(),
	);
	const retrySeedScheduler = new ManualShadowScheduler();
	const retrySeedWriter = new IndexV8ShadowWriter(retryStore, { scheduler: retrySeedScheduler });
	const retryDecision = retrySeedWriter.inspectStartupSeed(snapshot.manifest.committedAt, snapshot.manifest.indexSemanticsSignature);
	await waitFor(() => retrySeedScheduler.pendingTimerCount === 1, 'startup seed retry timer');
	await retrySeedScheduler.advanceBy(5_000);
	deepEqual(await retryDecision, { action: 'deferred', code: 'INCOMPLETE' });

	const invalidStore = new FakeShadowStore();
	invalidStore.loads.push({
		status: 'invalid',
		retryable: false,
		code: 'CHECKSUM_MISMATCH',
		metrics: { manifestBytes: 0, shardBytes: 0, shardsRead: 0, totalMs: 0 },
	});
	const invalidWriter = new IndexV8ShadowWriter(invalidStore, { scheduler: new ManualShadowScheduler() });
	deepEqual(
		await invalidWriter.inspectStartupSeed(snapshot.manifest.committedAt, snapshot.manifest.indexSemanticsSignature),
		{ action: 'disabled', code: 'CHECKSUM_MISMATCH' },
	);
	equal(invalidWriter.getStatus().phase, 'disabled');
}

async function testRealStoreAndTelemetryPrivacy(): Promise<void> {
	const adapter = new IndexV8MemoryAdapter();
	const paths = buildOperonStoragePaths('.obsidian', 'operon-shadow-test').runtime.indexV8;
	const writer = new IndexV8ShadowWriter(new IndexV8Store(adapter.asDataAdapter(), paths), {
		scheduler: new ManualShadowScheduler(),
	});
	const debugLines: string[] = [];
	const originalDebug = console.debug;
	console.debug = (...args: unknown[]) => { debugLines.push(args.join(' ')); };
	setOperonEnginePerfDebug(true);
	try {
		const firstData = createSyntheticIndexData(100);
		const firstTask = Object.values(firstData.tasks)[0];
		const firstInstance = Object.values(firstData.taskInstances ?? {})[0];
		firstTask.description = PRIVATE_DESCRIPTION;
		firstInstance.description = PRIVATE_DESCRIPTION;
		writer.enqueue(makeInput(1, firstData), { immediate: true });
		await writer.drain();
		const firstLoad = await new IndexV8Store(adapter.asDataAdapter(), paths).load();
		check(firstLoad.status === 'loaded');
		if (firstLoad.status !== 'loaded') throw new Error('Expected first real shadow snapshot');
		equal(firstLoad.manifest.shards.length, 32);
		const shardNamesAfterFirst = new Set(
			[...adapter.files.keys()].filter(path => path.startsWith(`${paths.shardsPath}/`)),
		);

		writer.enqueue(makeInput(2, firstData), { immediate: true });
		await writer.drain();
		const shardNamesAfterNoop = new Set(
			[...adapter.files.keys()].filter(path => path.startsWith(`${paths.shardsPath}/`)),
		);
		deepEqual(shardNamesAfterNoop, shardNamesAfterFirst);

		const changedData = structuredClone(firstData);
		Object.values(changedData.tasks)[0].description += ' changed';
		Object.values(changedData.taskInstances ?? {})[0].description += ' changed';
		writer.enqueue(makeInput(3, changedData), { immediate: true });
		await writer.drain();
		const shardNamesAfterChange = new Set(
			[...adapter.files.keys()].filter(path => path.startsWith(`${paths.shardsPath}/`)),
		);
		const changedLoad = await new IndexV8Store(adapter.asDataAdapter(), paths).load();
		check(changedLoad.status === 'loaded');
		if (changedLoad.status !== 'loaded') throw new Error('Expected changed shadow snapshot');
		const changedDescriptorCount = firstLoad.manifest.shards.filter((descriptor, index) => (
			descriptor.sha256 !== changedLoad.manifest.shards[index].sha256
		)).length;
		equal(changedDescriptorCount, 1);
		equal(shardNamesAfterChange.size, shardNamesAfterFirst.size + 1);
	} finally {
		setOperonEnginePerfDebug(false);
		console.debug = originalDebug;
	}
	const logPayload = debugLines.join('\n');
	check(logPayload.includes('index.v8.shadow'));
	check(!logPayload.includes(PRIVATE_DESCRIPTION));
	check(!logPayload.includes(PRIVATE_PATH));
	check(!logPayload.includes(PRIVATE_ID));
	check(!adapter.operations.some(operation => operation.includes('/runtime/index.json')));
}

async function run(): Promise<void> {
	await testParityAndPrivacy();
	await testIndexerV8PrimaryOrderingAndSealedSnapshot();
	await testSchedulingAndSealing();
	await testLatestWinsAndRetry();
	await testParityBlocksCommitAndMetadataGate();
	await testStartupClassification();
	await testIndexerStartupSeedAndUnloadDrain();
	await testRealStoreAndTelemetryPrivacy();
	process.stdout.write(`${JSON.stringify({ ok: true, assertions })}\n`);
}

declare global {
	var __operonIndexV8ShadowTestRun: Promise<void> | undefined;
}

globalThis.__operonIndexV8ShadowTestRun = run();
