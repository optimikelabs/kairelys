export const HYDRATION_ACCEPTANCE_THRESHOLD = 1.2;
export const HYDRATION_ACCEPTANCE_PAIRED_SAMPLES = 60;
export const HYDRATION_ACCEPTANCE_HEAP_SAMPLES = 15;

export interface AcceptanceSampleStats {
	min: number;
	p50: number;
	p95: number;
	max: number;
}

export interface AcceptanceRunResult {
	contract: 'operon-index-v8-hydration-acceptance-run-v1';
	environment: {
		node: string;
		platform: string;
		arch: string;
		diskContract: 'warm-page-cache-startup';
	};
	profile: { taskInstances: 1_000; sources: number; shards: 32 };
	ioConcurrency: 4;
	warmupPairs: 10;
	pairedSamples: 60;
	heapSamples: 15;
	timing: {
		v7Ms: AcceptanceSampleStats;
		v8Ms: AcceptanceSampleStats;
		v8ToV7P95Ratio: number;
		orderGroups: {
			ab: {
				samples: 30;
				v7Ms: AcceptanceSampleStats;
				v8Ms: AcceptanceSampleStats;
				pairedV8ToV7Ratio: AcceptanceSampleStats;
			};
			ba: {
				samples: 30;
				v7Ms: AcceptanceSampleStats;
				v8Ms: AcceptanceSampleStats;
				pairedV8ToV7Ratio: AcceptanceSampleStats;
			};
		};
	};
	heap: {
		v7Bytes: AcceptanceSampleStats;
		v8Bytes: AcceptanceSampleStats;
		v8ToV7P95Ratio: number;
	};
	integrity: {
		v8Loaded32Shards: boolean;
		taskInstanceCountParity: boolean;
		canonicalTaskCountParity: boolean;
		secondaryIndexParity: boolean;
		taskSemanticParity: boolean;
		duplicateCanonicalParity: boolean;
		resultSinkAdvanced: boolean;
	};
}

export interface AcceptanceRunClassification {
	stability: 'stable' | 'inconclusive';
	gate: 'pass' | 'fail' | 'inconclusive';
	reasons: string[];
}

export interface AcceptanceClassification {
	status: 'pass' | 'fail' | 'inconclusive';
	stable: boolean;
	threshold: number;
	reasons: string[];
	runs: AcceptanceRunClassification[];
}

export function classifyAcceptanceRun(
	run: AcceptanceRunResult,
	threshold: number = HYDRATION_ACCEPTANCE_THRESHOLD,
): AcceptanceRunClassification {
	const reasons: string[] = [];
	if (run.contract !== 'operon-index-v8-hydration-acceptance-run-v1') reasons.push('contract-mismatch');
	if (run.environment.diskContract !== 'warm-page-cache-startup') reasons.push('disk-contract-mismatch');
	if (!run.environment.node || !run.environment.platform || !run.environment.arch) reasons.push('environment-missing');
	if (run.profile.taskInstances !== 1_000 || run.profile.shards !== 32) reasons.push('profile-mismatch');
	if (run.ioConcurrency !== 4) reasons.push('io-concurrency-mismatch');
	if (run.warmupPairs !== 10 || run.pairedSamples !== HYDRATION_ACCEPTANCE_PAIRED_SAMPLES) {
		reasons.push('timing-sample-count-mismatch');
	}
	if (run.heapSamples !== HYDRATION_ACCEPTANCE_HEAP_SAMPLES) reasons.push('heap-sample-count-mismatch');
	if (run.timing.orderGroups.ab.samples !== 30 || run.timing.orderGroups.ba.samples !== 30) {
		reasons.push('unbalanced-order-groups');
	}
	const integrityKeys: Array<keyof AcceptanceRunResult['integrity']> = [
		'v8Loaded32Shards',
		'taskInstanceCountParity',
		'canonicalTaskCountParity',
		'secondaryIndexParity',
		'taskSemanticParity',
		'duplicateCanonicalParity',
		'resultSinkAdvanced',
	];
	const reportedIntegrityKeys = Object.keys(run.integrity).sort();
	const expectedIntegrityKeys = [...integrityKeys].sort();
	if (reportedIntegrityKeys.join(',') !== expectedIntegrityKeys.join(',')) {
		reasons.push('integrity-contract-mismatch');
	}
	if (integrityKeys.some(key => run.integrity[key] !== true)) reasons.push('integrity-failed');
	for (const [name, stats] of Object.entries({
		v7: run.timing.v7Ms,
		v8: run.timing.v8Ms,
		heapV7: run.heap.v7Bytes,
		heapV8: run.heap.v8Bytes,
	})) {
		if (!isValidStats(stats, name.startsWith('heap'))) reasons.push(`${name}-stats-invalid`);
	}
	if (!isFinitePositive(run.timing.v8ToV7P95Ratio) || !isFinitePositive(run.heap.v8ToV7P95Ratio)) {
		reasons.push('ratio-invalid');
	}
	if (!ratioMatches(run.timing.v8ToV7P95Ratio, run.timing.v8Ms.p95, run.timing.v7Ms.p95)) {
		reasons.push('load-ratio-mismatch');
	}
	if (!ratioMatches(run.heap.v8ToV7P95Ratio, run.heap.v8Bytes.p95, run.heap.v7Bytes.p95)) {
		reasons.push('heap-ratio-mismatch');
	}
	if (orderBiasRatio(run.timing.orderGroups.ab.v7Ms.p50, run.timing.orderGroups.ba.v7Ms.p50) > 1.15) {
		reasons.push('v7-order-bias');
	}
	if (orderBiasRatio(run.timing.orderGroups.ab.v8Ms.p50, run.timing.orderGroups.ba.v8Ms.p50) > 1.15) {
		reasons.push('v8-order-bias');
	}
	for (const [name, group] of Object.entries(run.timing.orderGroups)) {
		if (!isValidStats(group.pairedV8ToV7Ratio, true)) reasons.push(`${name}-paired-ratio-stats-invalid`);
	}
	if (orderBiasRatio(
		run.timing.orderGroups.ab.pairedV8ToV7Ratio.p50,
		run.timing.orderGroups.ba.pairedV8ToV7Ratio.p50,
	) > 1.15) reasons.push('paired-order-ratio-bias');
	if (!isTimingTailStable(run.timing.v7Ms) || !isTimingTailStable(run.timing.v8Ms)) {
		reasons.push('timing-tail-unstable');
	}
	if (run.heap.v7Bytes.p95 / run.heap.v7Bytes.p50 > 1.25 || run.heap.v8Bytes.p95 / run.heap.v8Bytes.p50 > 1.25) {
		reasons.push('heap-tail-unstable');
	}
	if (reasons.length > 0) return { stability: 'inconclusive', gate: 'inconclusive', reasons };
	const passed = run.timing.v8ToV7P95Ratio <= threshold && run.heap.v8ToV7P95Ratio <= threshold;
	return {
		stability: 'stable',
		gate: passed ? 'pass' : 'fail',
		reasons: passed ? [] : [
			...(run.timing.v8ToV7P95Ratio > threshold ? ['load-p95-regression'] : []),
			...(run.heap.v8ToV7P95Ratio > threshold ? ['heap-p95-regression'] : []),
		],
	};
}

function isTimingTailStable(stats: AcceptanceSampleStats): boolean {
	return stats.max <= Math.max(4 * stats.p50, stats.p50 + 25);
}

export function classifyAcceptance(
	runResults: AcceptanceRunResult[],
	threshold: number = HYDRATION_ACCEPTANCE_THRESHOLD,
): AcceptanceClassification {
	if (runResults.length !== 2) {
		return {
			status: 'inconclusive',
			stable: false,
			threshold,
			reasons: ['expected-two-child-runs'],
			runs: runResults.map(run => classifyAcceptanceRun(run, threshold)),
		};
	}
	const runs = runResults.map(run => classifyAcceptanceRun(run, threshold));
	if (runs.some(run => run.stability !== 'stable')) {
		return { status: 'inconclusive', stable: false, threshold, reasons: ['unstable-child-run'], runs };
	}
	if (runs.every(run => run.gate === 'pass')) {
		return { status: 'pass', stable: true, threshold, reasons: [], runs };
	}
	if (runs.every(run => run.gate === 'fail')) {
		return { status: 'fail', stable: true, threshold, reasons: ['two-run-regression-confirmed'], runs };
	}
	return { status: 'inconclusive', stable: true, threshold, reasons: ['mixed-gate-results'], runs };
}

function isValidStats(stats: AcceptanceSampleStats, requirePositiveMedian: boolean): boolean {
	const values = [stats.min, stats.p50, stats.p95, stats.max];
	return values.every(Number.isFinite)
		&& stats.min <= stats.p50
		&& stats.p50 <= stats.p95
		&& stats.p95 <= stats.max
		&& (requirePositiveMedian ? stats.min > 0 : stats.min >= 0);
}

function orderBiasRatio(left: number, right: number): number {
	if (!isFinitePositive(left) || !isFinitePositive(right)) return Number.POSITIVE_INFINITY;
	return Math.max(left, right) / Math.min(left, right);
}

function ratioMatches(reported: number, numerator: number, denominator: number): boolean {
	if (!isFinitePositive(reported) || !isFinitePositive(numerator) || !isFinitePositive(denominator)) return false;
	return Math.abs(reported - numerator / denominator) <= 0.002;
}

function isFinitePositive(value: number): boolean {
	return Number.isFinite(value) && value > 0;
}
