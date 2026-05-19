import {
	applySchedulingRules,
	SchedulingKey,
} from './scheduling-rules';

export interface FieldRuleInput {
	current: Record<string, string>;
	patch: Record<string, string>;
	changedKeys: string[];
}

export interface FieldRuleResult {
	patch: Record<string, string>;
}

const SCHEDULING_KEYS = new Set<SchedulingKey>([
	'dateScheduled',
	'datetimeStart',
	'datetimeEnd',
	'estimate',
]);

export function applyFieldRules(input: FieldRuleInput): FieldRuleResult {
	let patch = { ...input.patch };
	const schedulingChangedKeys = input.changedKeys.filter((key): key is SchedulingKey => SCHEDULING_KEYS.has(key as SchedulingKey));
	if (schedulingChangedKeys.length > 0 || hasSchedulingState(input.current, patch)) {
		patch = applySchedulingRules({
			current: input.current,
			patch,
			changedKeys: schedulingChangedKeys,
		}).patch;
	}
	return { patch };
}

function hasSchedulingState(current: Record<string, string>, patch: Record<string, string>): boolean {
	return (
		!!(current['datetimeStart'] ?? '').trim()
		|| !!(current['datetimeEnd'] ?? '').trim()
		|| !!(current['dateScheduled'] ?? '').trim()
		|| Object.keys(patch).some(key => SCHEDULING_KEYS.has(key as SchedulingKey))
	);
}
