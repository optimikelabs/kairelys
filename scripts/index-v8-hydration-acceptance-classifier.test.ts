import assert from 'node:assert/strict';
import {
	classifyAcceptance,
	classifyAcceptanceRun,
	type AcceptanceRunResult,
} from './index-v8-hydration-acceptance-classifier';

const passingRun = createRun(1.1, 1.05);
assert.deepEqual(classifyAcceptanceRun(passingRun), {
	stability: 'stable',
	gate: 'pass',
	reasons: [],
});

const failingRun = createRun(1.21, 1.05);
assert.deepEqual(classifyAcceptanceRun(failingRun), {
	stability: 'stable',
	gate: 'fail',
	reasons: ['load-p95-regression'],
});

assert.equal(classifyAcceptance([passingRun, structuredClone(passingRun)]).status, 'pass');
assert.equal(classifyAcceptance([failingRun, structuredClone(failingRun)]).status, 'fail');
assert.equal(classifyAcceptance([passingRun, failingRun]).status, 'inconclusive');

const biasedRun = createRun(1.1, 1.05);
biasedRun.timing.orderGroups.ba.v8Ms = stats(11, 11.6, 12, 13);
const biasedResult = classifyAcceptance([biasedRun, structuredClone(biasedRun)]);
assert.equal(biasedResult.status, 'inconclusive');
assert.ok(biasedResult.runs[0].reasons.includes('v8-order-bias'));

const unstableTail = createRun(1.1, 1.05);
unstableTail.timing.v8Ms = stats(9, 10, 20, 41);
const unstableTailResult = classifyAcceptanceRun(unstableTail);
assert.equal(unstableTailResult.stability, 'inconclusive');
assert.ok(unstableTailResult.reasons.includes('timing-tail-unstable'));

const wrongSampleCount = createRun(1.1, 1.05);
wrongSampleCount.pairedSamples = 59 as 60;
assert.equal(classifyAcceptance([wrongSampleCount, structuredClone(wrongSampleCount)]).status, 'inconclusive');

const wrongContract = createRun(1.1, 1.05);
wrongContract.ioConcurrency = 8 as 4;
wrongContract.environment.diskContract = 'cold-cache' as 'warm-page-cache-startup';
const wrongContractResult = classifyAcceptanceRun(wrongContract);
assert.ok(wrongContractResult.reasons.includes('io-concurrency-mismatch'));
assert.ok(wrongContractResult.reasons.includes('disk-contract-mismatch'));

const invalidHeap = createRun(1.1, 1.05);
invalidHeap.heap.v8Bytes.min = 0;
assert.ok(classifyAcceptanceRun(invalidHeap).reasons.includes('heapV8-stats-invalid'));

const p95OrderBias = createRun(1.1, 1.05);
p95OrderBias.timing.orderGroups.ba.pairedV8ToV7Ratio = stats(1.3, 1.3, 1.3, 1.3);
assert.ok(classifyAcceptanceRun(p95OrderBias).reasons.includes('paired-order-ratio-bias'));

const incompleteIntegrity = createRun(1.1, 1.05);
delete (incompleteIntegrity.integrity as Partial<AcceptanceRunResult['integrity']>).duplicateCanonicalParity;
assert.ok(classifyAcceptanceRun(incompleteIntegrity).reasons.includes('integrity-contract-mismatch'));
assert.ok(classifyAcceptanceRun(incompleteIntegrity).reasons.includes('integrity-failed'));

const extraIntegrity = createRun(1.1, 1.05);
(extraIntegrity.integrity as AcceptanceRunResult['integrity'] & { futureParity: boolean }).futureParity = false;
assert.ok(classifyAcceptanceRun(extraIntegrity).reasons.includes('integrity-contract-mismatch'));

const falseReportedRatio = createRun(1.1, 1.05);
falseReportedRatio.timing.v8ToV7P95Ratio = 1;
assert.ok(classifyAcceptanceRun(falseReportedRatio).reasons.includes('load-ratio-mismatch'));

function createRun(loadRatio: number, heapRatio: number): AcceptanceRunResult {
	return {
		contract: 'operon-index-v8-hydration-acceptance-run-v1',
		environment: {
			node: process.version,
			platform: process.platform,
			arch: process.arch,
			diskContract: 'warm-page-cache-startup',
		},
		profile: { taskInstances: 1_000, sources: 200, shards: 32 },
		ioConcurrency: 4,
		warmupPairs: 10,
		pairedSamples: 60,
		heapSamples: 15,
		timing: {
			v7Ms: stats(9, 10, 11, 12),
			v8Ms: stats(9 * loadRatio, 10 * loadRatio, 11 * loadRatio, 12 * loadRatio),
			v8ToV7P95Ratio: loadRatio,
			orderGroups: {
				ab: {
					samples: 30,
					v7Ms: stats(9, 10, 11, 12),
					v8Ms: stats(9, 10, 11, 12),
					pairedV8ToV7Ratio: stats(1, 1, 1, 1),
				},
				ba: {
					samples: 30,
					v7Ms: stats(9, 10, 11, 12),
					v8Ms: stats(9, 10, 11, 12),
					pairedV8ToV7Ratio: stats(1, 1, 1, 1),
				},
			},
		},
		heap: {
			v7Bytes: stats(900, 1_000, 1_100, 1_200),
			v8Bytes: stats(900 * heapRatio, 1_000 * heapRatio, 1_100 * heapRatio, 1_200 * heapRatio),
			v8ToV7P95Ratio: heapRatio,
		},
		integrity: {
			v8Loaded32Shards: true,
			taskInstanceCountParity: true,
			canonicalTaskCountParity: true,
			secondaryIndexParity: true,
			taskSemanticParity: true,
			duplicateCanonicalParity: true,
			resultSinkAdvanced: true,
		},
	};
}

function stats(min: number, p50: number, p95: number, max: number) {
	return { min, p50, p95, max };
}
