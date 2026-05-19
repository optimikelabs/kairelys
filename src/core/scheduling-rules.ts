export type SchedulingKey =
	| 'dateScheduled'
	| 'datetimeStart'
	| 'datetimeEnd'
	| 'estimate';

export interface SchedulingRuleInput {
	current: Record<string, string>;
	patch: Record<string, string>;
	changedKeys: SchedulingKey[];
}

export interface SchedulingRuleResult {
	patch: Record<string, string>;
}

const SCHEDULING_KEYS = new Set<SchedulingKey>([
	'dateScheduled',
	'datetimeStart',
	'datetimeEnd',
	'estimate',
]);

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function applySchedulingRules(
	input: SchedulingRuleInput,
): SchedulingRuleResult {
	const nextPatch: Record<string, string> = { ...input.patch };
	const merged: Record<string, string> = {
		...input.current,
		...input.patch,
	};
	const changedKeys = input.changedKeys.filter((key): key is SchedulingKey => SCHEDULING_KEYS.has(key));
	const lastChanged = changedKeys[changedKeys.length - 1] ?? null;

	const startExplicit = hasOwn(input.patch, 'datetimeStart');
	const scheduledExplicit = hasOwn(input.patch, 'dateScheduled');
	const startCleared = startExplicit && !trimValue(merged['datetimeStart']);
	const scheduledCleared = scheduledExplicit && !trimValue(merged['dateScheduled']);

	if (scheduledCleared) {
		setPatchValue(nextPatch, merged, 'datetimeStart', '');
		setPatchValue(nextPatch, merged, 'datetimeEnd', '');
	}

	if (startCleared) {
		setPatchValue(nextPatch, merged, 'datetimeEnd', '');
	}

	if (
		lastChanged === 'dateScheduled'
		&& !scheduledCleared
		&& trimValue(merged['datetimeStart'])
	) {
		const targetDate = extractDatePart(merged['dateScheduled']);
		const previousStartDate = extractDatePart(merged['datetimeStart']);
		if (targetDate && previousStartDate && targetDate !== previousStartDate) {
			const dayDelta = diffDateParts(previousStartDate, targetDate);
			const shiftedStart = replaceDatetimeDate(merged['datetimeStart'], targetDate);
			if (shiftedStart) {
				setPatchValue(nextPatch, merged, 'datetimeStart', shiftedStart);
			}
			if (trimValue(merged['datetimeEnd'])) {
				const shiftedEnd = shiftDatetimeByDays(merged['datetimeEnd'], dayDelta);
				if (shiftedEnd) {
					setPatchValue(nextPatch, merged, 'datetimeEnd', shiftedEnd);
				}
			}
		}
	}

	if (!trimValue(merged['datetimeStart']) && trimValue(merged['datetimeEnd'])) {
		setPatchValue(nextPatch, merged, 'datetimeEnd', '');
	}

	const estimateSeconds = parseEstimateSeconds(merged['estimate']);
	const startValue = trimValue(merged['datetimeStart']);
	const endValue = trimValue(merged['datetimeEnd']);

	if (lastChanged === 'estimate' && startValue && estimateSeconds === null) {
		setPatchValue(nextPatch, merged, 'datetimeStart', '');
		setPatchValue(nextPatch, merged, 'datetimeEnd', '');
	}

	if (lastChanged === 'estimate' && startValue && estimateSeconds !== null) {
		const derivedEnd = deriveDatetimeEnd(startValue, estimateSeconds);
		if (derivedEnd) {
			setPatchValue(nextPatch, merged, 'datetimeEnd', derivedEnd);
		}
	}

	if (lastChanged === 'datetimeEnd' && startValue && endValue) {
		setPatchValue(nextPatch, merged, 'estimate', deriveEstimateValue(startValue, endValue));
	}

	if (lastChanged === 'datetimeStart' && startValue) {
		if (estimateSeconds !== null) {
			const derivedEnd = deriveDatetimeEnd(startValue, estimateSeconds);
			if (derivedEnd) {
				setPatchValue(nextPatch, merged, 'datetimeEnd', derivedEnd);
			}
		} else if (endValue) {
			setPatchValue(nextPatch, merged, 'estimate', deriveEstimateValue(startValue, endValue));
		}
	}

	if (lastChanged === 'dateScheduled' && startValue && !trimValue(merged['datetimeEnd']) && estimateSeconds !== null) {
		const derivedEnd = deriveDatetimeEnd(startValue, estimateSeconds);
		if (derivedEnd) {
			setPatchValue(nextPatch, merged, 'datetimeEnd', derivedEnd);
		}
	}

	const finalStart = trimValue(merged['datetimeStart']);
	if (!finalStart) {
		setPatchValue(nextPatch, merged, 'datetimeEnd', '');
	} else {
		const startDate = extractDatePart(finalStart);
		if (startDate) {
			setPatchValue(nextPatch, merged, 'dateScheduled', startDate);
		}
	}

	return { patch: nextPatch };
}

function hasOwn(value: Record<string, string>, key: SchedulingKey): boolean {
	return Object.prototype.hasOwnProperty.call(value, key) === true;
}

function trimValue(value: string | undefined): string {
	return (value ?? '').trim();
}

function setPatchValue(
	patch: Record<string, string>,
	merged: Record<string, string>,
	key: SchedulingKey,
	value: string,
): void {
	patch[key] = value;
	merged[key] = value;
}

export function extractDatePart(value: string | undefined | null): string {
	const trimmed = trimValue(value ?? '');
	if (!trimmed) return '';
	const dateMatch = DATE_RE.exec(trimmed);
	if (dateMatch) return trimmed;
	const datetimeMatch = DATETIME_RE.exec(trimmed);
	if (!datetimeMatch) return '';
	return `${datetimeMatch[1]}-${datetimeMatch[2]}-${datetimeMatch[3]}`;
}

export function extractTimePart(value: string | undefined | null): string {
	const trimmed = trimValue(value ?? '');
	if (!trimmed) return '';
	const datetimeMatch = DATETIME_RE.exec(trimmed);
	if (!datetimeMatch) return '';
	const seconds = datetimeMatch[6] ?? '00';
	return `${datetimeMatch[4]}:${datetimeMatch[5]}:${seconds}`;
}

export function buildCanonicalLocalDatetime(datePart: string, timePart: string): string {
	const normalizedDate = extractDatePart(datePart);
	const normalizedTime = normalizeTimePart(timePart);
	if (!normalizedDate || !normalizedTime) return '';
	return `${normalizedDate}T${normalizedTime}`;
}

export function replaceDatetimeDate(value: string, nextDatePart: string): string {
	const timePart = extractTimePart(value);
	if (!timePart) return '';
	return buildCanonicalLocalDatetime(nextDatePart, timePart);
}

export function shiftDatetimeByDays(value: string, dayDelta: number): string {
	const parsed = parseLocalDatetimeValue(value);
	if (!parsed) return '';
	parsed.date.setDate(parsed.date.getDate() + dayDelta);
	return formatLocalDatetime(parsed.date);
}

export function parseEstimateSeconds(value: string | undefined | null): number | null {
	const trimmed = trimValue(value ?? '');
	if (!trimmed) return null;
	const seconds = Number.parseInt(trimmed, 10);
	if (!Number.isFinite(seconds) || seconds <= 0) return null;
	return seconds;
}

export function deriveDatetimeEnd(startValue: string, estimateSeconds: number): string {
	const parsed = parseLocalDatetimeValue(startValue);
	if (!parsed || !Number.isFinite(estimateSeconds) || estimateSeconds <= 0) return '';
	const end = new Date(parsed.date.getTime() + estimateSeconds * 1000);
	return formatLocalDatetime(end);
}

export function deriveEstimateValue(startValue: string, endValue: string): string {
	const start = parseLocalDatetimeValue(startValue);
	const end = parseLocalDatetimeValue(endValue);
	if (!start || !end) return '';
	const seconds = Math.round((end.date.getTime() - start.date.getTime()) / 1000);
	return seconds > 0 ? String(seconds) : '';
}

export function diffDateParts(fromDatePart: string, toDatePart: string): number {
	const from = parseDatePart(fromDatePart);
	const to = parseDatePart(toDatePart);
	if (!from || !to) return 0;
	const msPerDay = 24 * 60 * 60 * 1000;
	return Math.round((to.getTime() - from.getTime()) / msPerDay);
}

function normalizeTimePart(value: string): string {
	const trimmed = trimValue(value);
	if (!trimmed) return '';
	const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
	if (!match) return '';
	return `${match[1]}:${match[2]}:${match[3] ?? '00'}`;
}

function parseDatePart(value: string): Date | null {
	const match = DATE_RE.exec(trimValue(value));
	if (!match) return null;
	return new Date(
		Number.parseInt(match[1], 10),
		Number.parseInt(match[2], 10) - 1,
		Number.parseInt(match[3], 10),
		12,
		0,
		0,
		0,
	);
}

function parseLocalDatetimeValue(value: string): { date: Date } | null {
	const match = DATETIME_RE.exec(trimValue(value));
	if (!match) return null;
	const date = new Date(
		Number.parseInt(match[1], 10),
		Number.parseInt(match[2], 10) - 1,
		Number.parseInt(match[3], 10),
		Number.parseInt(match[4], 10),
		Number.parseInt(match[5], 10),
		Number.parseInt(match[6] ?? '0', 10),
		0,
	);
	return { date };
}

function formatLocalDatetime(date: Date): string {
	return `${formatDatePart(date)}T${formatTimePart(date)}`;
}

function formatDatePart(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatTimePart(date: Date): string {
	return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}
