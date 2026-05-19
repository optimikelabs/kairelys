/**
 * Recurrence engine for Operon tasks.
 * Creates new occurrences when recurring tasks are completed.
 *
 * Spec Section 21:
 * - On task completion (checkbox → done), if repeat field exists, create new occurrence
 * - New task gets fresh operonId, updated dateScheduled, cleared duration/trackers
 * - datetimeRepeatEnd check before creating occurrence
 * - Meta-data fields copied, per-instance fields reset
 * - New occurrence position configurable (above/below)
 */

import { App } from 'obsidian';
import { OperonIndexer } from '../indexer/indexer';
import { ParsedTask } from '../types/fields';
import { parseRepeatRule, calculateNextDate, isRecurrenceExpired } from '../core/recurrence-parser';
import { serializeTask } from '../core/serializer';
import { generateOperonId } from '../core/id-generator';
import { localNow } from '../core/local-time';
import { TASK_STATS_CANONICAL_KEYS } from '../types/keys';

/** Fields copied to new occurrence (meta-data) */
const COPIED_FIELDS = new Set([
	'assignees', 'priority', 'status', 'contexts', 'parentTask',
	'repeat', 'datetimeRepeatEnd', 'estimate',
	'datetimeStart', 'datetimeEnd', // Time-of-day preserved
	'note', 'taskIcon', 'taskColor',
]);

/** Fields reset/removed in new occurrence */
const RESET_FIELDS = new Set([
	'dateCompleted', 'dateCancelled', 'duration', 'trackers', 'activeTracker',
	'progress', ...TASK_STATS_CANONICAL_KEYS, 'totalEstimate', 'totalDuration',
	'blocking', 'blockedBy', // Dependencies not inherited
]);

export class RecurrenceEngine {
	private app: App;
	private indexer: OperonIndexer;

	constructor(app: App, indexer: OperonIndexer) {
		this.app = app;
		this.indexer = indexer;
	}

	/**
	 * Handle task completion for recurring tasks.
	 * Returns the new occurrence task line if created, or null.
	 *
	 * @param completedTask - The parsed task that was just completed
	 * @param completionDate - The date of completion (YYYY-MM-DD)
	 * @returns New task line string or null if no recurrence
	 */
	createNextOccurrence(
		completedTask: ParsedTask,
		completionDate: string,
	): string | null {
		// Find repeat field
		const repeatField = completedTask.fields.find(f => f.key === 'repeat');
		if (!repeatField) return null;

		// Parse recurrence rule
		const rule = parseRepeatRule(repeatField.value);
		if (!rule) return null; // Unparseable rule — skip

		// Calculate next scheduled date
		const baseDate = this.getBaseDate(completedTask, completionDate);
		const nextDate = calculateNextDate(baseDate, rule);

		// Check datetimeRepeatEnd
		const repeatEnd = completedTask.fields.find(f => f.key === 'datetimeRepeatEnd')?.value;
		if (repeatEnd && isRecurrenceExpired(nextDate, repeatEnd)) {
			return null; // Recurrence expired
		}

		// Build new occurrence
		const newFields = [];
		const now = localNow();
		const newId = generateOperonId();

		// operonId (fresh)
		newFields.push({
			sourceKey: 'operonId',
			key: 'operonId', value: newId, rawValue: newId,
			type: 'text' as const, isCanonical: true,
			containerRange: { from: 0, to: 0 },
			valueRange: { from: 0, to: 0 },
		});

		// datetimeCreated (fresh)
		newFields.push({
			sourceKey: 'datetimeCreated',
			key: 'datetimeCreated', value: now, rawValue: now,
			type: 'datetime' as const, isCanonical: true,
			containerRange: { from: 0, to: 0 },
			valueRange: { from: 0, to: 0 },
		});

		// dateScheduled (next occurrence)
		newFields.push({
			sourceKey: 'dateScheduled',
			key: 'dateScheduled', value: nextDate, rawValue: nextDate,
			type: 'date' as const, isCanonical: true,
			containerRange: { from: 0, to: 0 },
			valueRange: { from: 0, to: 0 },
		});

		// Copy applicable fields from completed task
		for (const field of completedTask.fields) {
			if (field.key === 'operonId' || field.key === 'datetimeCreated' || field.key === 'dateScheduled') continue;
			if (RESET_FIELDS.has(field.key)) continue;

			if (COPIED_FIELDS.has(field.key)) {
				// For time fields, shift dates but keep times
				if ((field.key === 'datetimeStart' || field.key === 'datetimeEnd') && nextDate.length === 10) {
					const timeOnly = field.value.length <= 5; // "HH:mm" format
					if (timeOnly) {
						newFields.push({ ...field });
					} else {
						// Full datetime — shift date portion
						const timePart = field.value.substring(10); // "THH:mm:ss" part
						newFields.push({ ...field, value: nextDate + timePart, rawValue: nextDate + timePart });
					}
				} else {
					newFields.push({ ...field });
				}
			}
		}

		// datetimeModified (fresh)
		newFields.push({
			sourceKey: 'datetimeModified',
			key: 'datetimeModified', value: now, rawValue: now,
			type: 'datetime' as const, isCanonical: true,
			containerRange: { from: 0, to: 0 },
			valueRange: { from: 0, to: 0 },
		});

		// Build new ParsedTask
		const newTask: ParsedTask = {
			lineNumber: 0,
			filePath: completedTask.filePath,
			checkbox: 'open',
			checkboxRange: { from: 0, to: 0 },
			description: completedTask.description,
			descriptionRange: { from: 0, to: 0 },
			fields: newFields,
			tags: [...completedTask.tags],
			tagTokens: [],
			metadataTailRange: null,
			operonId: newId,
			rawLine: '',
			timePrefix: completedTask.timePrefix ? { ...completedTask.timePrefix } : null,
			timePrefixRange: null,
		};

		return serializeTask(newTask);
	}

	/**
	 * Determine the base date for calculating next occurrence.
	 * For day+ recurrence: use dateScheduled or completion date.
	 * For sub-day recurrence: use completion datetime.
	 */
	private getBaseDate(task: ParsedTask, completionDate: string): string {
		const repeatField = task.fields.find(f => f.key === 'repeat');
		const rule = repeatField ? parseRepeatRule(repeatField.value) : null;

		// For sub-day units (minute, hour), use current datetime
		if (rule && (rule.unit === 'minute' || rule.unit === 'hour')) {
			return localNow();
		}

		// For day+ units, use dateScheduled if available, else completionDate
		const scheduled = task.fields.find(f => f.key === 'dateScheduled')?.value;
		return scheduled ?? completionDate;
	}
}
