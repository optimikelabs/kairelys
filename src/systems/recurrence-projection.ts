import { deriveDatetimeEnd, parseEstimateSeconds } from '../core/scheduling-rules';
import { parseRepeatRule, listRepeatOccurrencesInRange } from '../core/repeat-rule';
import {
	CalendarItem,
	buildCalendarRenderSnapshot,
} from '../types/calendar';
import { IndexedTask } from '../types/fields';
import {
	RepeatSeriesEntry,
	RepeatTemporalTemplate,
} from '../storage/repeat-series-store';
import {
	buildRepeatSeriesContexts,
	deriveTemporalTemplateFromTask,
	resolveOccurrencePlan,
	resolveProjectionRangePadding,
	shiftDateKey,
} from './recurrence-domain';
import {
	renderRepeatSeriesTitle,
	resolveLatestRepeatSeriesNamingConfig,
	resolveRecurringFileDisplayDate,
} from './recurring-file-naming';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

export interface ProjectedRecurringCalendarItemsInput {
	tasks: IndexedTask[];
	entries: RepeatSeriesEntry[];
	rangeStart: string;
	rangeEnd: string;
}

export function buildProjectedRecurringCalendarItems(
	input: ProjectedRecurringCalendarItemsInput,
): CalendarItem[] {
	const rangeStart = normalizeDate(input.rangeStart);
	const rangeEnd = normalizeDate(input.rangeEnd);
	if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) return [];

	const entryBySeriesId = new Map(input.entries.map(entry => [entry.seriesId, entry]));
	const projected: CalendarItem[] = [];

	for (const group of buildRepeatSeriesContexts(input.tasks)) {
		const latestRule = parseRepeatRule(group.latestTask.fieldValues['repeat']);
		if (!latestRule || latestRule.mode === 'done') continue;

		const entry = entryBySeriesId.get(group.seriesId);
		if (!entry) continue;

		const fallbackTemplate = deriveTemporalTemplateFromTask(group.earliestTask);
		const materializedOccurrenceDates = new Set(group.materializedOccurrenceDates);
		const projectionPaddingDays = resolveProjectionRangePadding(entry, fallbackTemplate);
		const projectionRangeStart = shiftDateKey(rangeStart, -projectionPaddingDays);
		const projectionRangeEnd = shiftDateKey(rangeEnd, projectionPaddingDays);
		const latestOccurrenceDate = group.latestOccurrenceDate;
		if (!latestOccurrenceDate) continue;
		const occurrenceDates = listRepeatOccurrencesInRange(latestRule, {
			anchorDate: latestOccurrenceDate,
			rangeStart: projectionRangeStart,
			rangeEnd: projectionRangeEnd,
			repeatEnd: group.latestTask.fieldValues['datetimeRepeatEnd'],
		});
		const snapshot = buildCalendarRenderSnapshot(group.latestTask);

		for (const occurrenceDate of occurrenceDates) {
			if (materializedOccurrenceDates.has(occurrenceDate)) continue;
			const item = buildProjectedItemForOccurrence({
				entry,
				occurrenceDate,
				rangeStart,
				rangeEnd,
				fallbackTemplate,
				snapshot,
			});
			if (item) projected.push(item);
		}
	}

	return projected;
}

function buildProjectedItemForOccurrence(
	input: {
		entry: RepeatSeriesEntry;
		occurrenceDate: string;
		rangeStart: string;
		rangeEnd: string;
		fallbackTemplate: RepeatTemporalTemplate;
		snapshot: ReturnType<typeof buildCalendarRenderSnapshot>;
	},
): CalendarItem | null {
	const occurrencePlan = resolveOccurrencePlan({
		entry: input.entry,
		occurrenceDate: input.occurrenceDate,
		fallbackTemplate: input.fallbackTemplate,
	});
	if (!occurrencePlan) return null;
	const scheduledDate = occurrencePlan.scheduledDate;
	const template = occurrencePlan.temporalTemplate;

	if (template.mode === 'timed') {
		const startDate = shiftDateKey(input.occurrenceDate, template.startDateShiftDays);
		const endDate = shiftDateKey(input.occurrenceDate, template.endDateShiftDays);
		const startDateTime = buildDateTimeValue(startDate, template.startTime);
		let endDateTime = buildDateTimeValue(endDate, template.endTime);
		if (startDateTime && !endDateTime) {
			const estimateSeconds = parseEstimateSeconds(input.snapshot.fieldValues['estimate']);
			if (estimateSeconds !== null) {
				endDateTime = deriveDatetimeEnd(startDateTime, estimateSeconds);
			}
		}
		if (!startDateTime || !endDateTime) return null;
		const timedStartDate = startDateTime.slice(0, 10);
		const timedEndDate = endDateTime.slice(0, 10);
		if (!intersectsDateRange(timedStartDate, timedEndDate, input.rangeStart, input.rangeEnd)) return null;
		return {
			taskId: `projected:${input.entry.seriesId}:${input.occurrenceDate}`,
			kind: 'timed',
			startDate: timedStartDate,
			endDate: timedEndDate,
			startDateTime,
			endDateTime,
			isDashed: false,
			isReadOnly: true,
			origin: 'projected',
			repeatRef: {
				seriesId: input.entry.seriesId,
				occurrenceDate: input.occurrenceDate,
				isLatestMaterialized: false,
				isProjected: true,
			},
			externalRef: null,
			sourceTask: null,
			renderSnapshot: {
				description: resolveProjectedDescription(input.entry, input.snapshot.description, scheduledDate, input.occurrenceDate),
				checkbox: input.snapshot.checkbox,
				fieldValues: {
					...input.snapshot.fieldValues,
					dateScheduled: scheduledDate,
					dateStarted: '',
					dateDue: '',
					repeatOccurrenceDate: input.occurrenceDate,
					datetimeStart: startDateTime,
					datetimeEnd: endDateTime,
				},
				tags: [...input.snapshot.tags],
			},
		};
	}

	const allDayStartDate = shiftDateKey(input.occurrenceDate, template.startDateShiftDays);
	const allDayEndDate = shiftDateKey(input.occurrenceDate, template.endDateShiftDays);
	if (!intersectsDateRange(allDayStartDate, allDayEndDate, input.rangeStart, input.rangeEnd)) return null;
	return {
		taskId: `projected:${input.entry.seriesId}:${input.occurrenceDate}`,
		kind: 'allDayScheduled',
		startDate: allDayStartDate,
		endDate: allDayEndDate,
		startDateTime: null,
		endDateTime: null,
		isDashed: false,
		isReadOnly: true,
		origin: 'projected',
		repeatRef: {
			seriesId: input.entry.seriesId,
			occurrenceDate: input.occurrenceDate,
			isLatestMaterialized: false,
			isProjected: true,
		},
		externalRef: null,
		sourceTask: null,
			renderSnapshot: {
				description: resolveProjectedDescription(input.entry, input.snapshot.description, scheduledDate, input.occurrenceDate),
				checkbox: input.snapshot.checkbox,
				fieldValues: {
					...input.snapshot.fieldValues,
				dateScheduled: scheduledDate,
				dateStarted: allDayStartDate,
				dateDue: allDayEndDate,
				repeatOccurrenceDate: input.occurrenceDate,
					datetimeStart: '',
					datetimeEnd: '',
				},
				tags: [...input.snapshot.tags],
			},
		};
	}

function resolveProjectedDescription(
	entry: RepeatSeriesEntry,
	fallbackDescription: string,
	scheduledDate: string,
	occurrenceDate: string,
): string {
	const naming = resolveLatestRepeatSeriesNamingConfig(fallbackDescription, entry.naming);
	if (!naming) return fallbackDescription;
	const displayDate = resolveRecurringFileDisplayDate({
		dateScheduled: scheduledDate,
		repeatOccurrenceDate: occurrenceDate,
	});
	return displayDate ? renderRepeatSeriesTitle(naming, displayDate) : fallbackDescription;
}

function normalizeDate(value: string | null | undefined): string {
	const trimmed = (value ?? '').trim();
	return DATE_RE.test(trimmed) ? trimmed : '';
}

function buildDateTimeValue(dateKey: string, timeValue: string | null): string | null {
	if (!DATE_RE.test(dateKey) || !timeValue) return null;
	return `${dateKey}T${timeValue}`;
}

function intersectsDateRange(startDate: string, endDate: string, rangeStart: string, rangeEnd: string): boolean {
	return startDate <= rangeEnd && endDate >= rangeStart;
}
