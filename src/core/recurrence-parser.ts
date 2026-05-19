/**
 * Natural language recurrence rule parser.
 * Parses repeat field values like "every day", "weekly", "every 2 hours".
 *
 * Spec Section 21.4:
 * - Supported units: minutely, hourly, daily, weekly, monthly, yearly
 * - Natural language: "every N unit", "daily", "weekly", etc.
 * - If parsing fails → treat as custom string
 */

import { toLocalDatetime, toLocalDate } from './local-time';

export interface RecurrenceRule {
	/** Unit of recurrence */
	unit: 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';
	/** Interval (e.g., 2 for "every 2 days") */
	interval: number;
}

/** Keyword → unit mapping */
const UNIT_ALIASES: Record<string, RecurrenceRule['unit']> = {
	'minute': 'minute', 'minutes': 'minute', 'minutely': 'minute', 'min': 'minute',
	'hour': 'hour', 'hours': 'hour', 'hourly': 'hour', 'hr': 'hour',
	'day': 'day', 'days': 'day', 'daily': 'day',
	'week': 'week', 'weeks': 'week', 'weekly': 'week',
	'weekday': 'day', 'weekdays': 'day', // Treated as daily for date math; UI can filter
	'month': 'month', 'months': 'month', 'monthly': 'month',
	'year': 'year', 'years': 'year', 'yearly': 'year', 'annually': 'year',
};

/**
 * Parse a natural language repeat rule.
 * Returns null if the rule can't be parsed.
 *
 * Supported formats:
 * - "daily", "weekly", "monthly", "yearly", "hourly", "minutely"
 * - "every day", "every week", "every month", "every year"
 * - "every 2 days", "every 3 weeks", "every 4 hours"
 * - "every weekday" (treated as daily)
 */
export function parseRepeatRule(rule: string): RecurrenceRule | null {
	const normalized = rule.trim().toLowerCase();

	// Single-word shortcuts: "daily", "weekly", etc.
	if (UNIT_ALIASES[normalized]) {
		return { unit: UNIT_ALIASES[normalized], interval: 1 };
	}

	// "every <unit>" or "every <N> <unit>"
	const everyMatch = normalized.match(/^every\s+(\d+\s+)?(.+)$/);
	if (everyMatch) {
		const intervalStr = everyMatch[1]?.trim();
		const unitStr = everyMatch[2]?.trim();

		if (!unitStr) return null;

		const unit = UNIT_ALIASES[unitStr];
		if (!unit) return null;

		const interval = intervalStr ? parseInt(intervalStr, 10) : 1;
		if (isNaN(interval) || interval < 1) return null;

		return { unit, interval };
	}

	return null;
}

/**
 * Calculate the next occurrence date based on a recurrence rule.
 *
 * @param baseDate - The reference date (usually dateCompleted)
 * @param rule - The parsed recurrence rule
 * @returns Next occurrence date as ISO string (YYYY-MM-DD or full datetime)
 */
export function calculateNextDate(baseDate: string, rule: RecurrenceRule): string {
	const date = new Date(baseDate);
	if (isNaN(date.getTime())) return baseDate;

	switch (rule.unit) {
		case 'minute':
			date.setMinutes(date.getMinutes() + rule.interval);
			break;
		case 'hour':
			date.setHours(date.getHours() + rule.interval);
			break;
		case 'day':
			date.setDate(date.getDate() + rule.interval);
			break;
		case 'week':
			date.setDate(date.getDate() + rule.interval * 7);
			break;
		case 'month':
			date.setMonth(date.getMonth() + rule.interval);
			break;
		case 'year':
			date.setFullYear(date.getFullYear() + rule.interval);
			break;
	}

	// Return date-only for day+ units, full datetime for sub-day units
	if (rule.unit === 'minute' || rule.unit === 'hour') {
		return toLocalDatetime(date);
	}

	return toLocalDate(date);
}

/**
 * Check if a next occurrence exceeds the repeat end date.
 */
export function isRecurrenceExpired(nextDate: string, repeatEndDate: string): boolean {
	if (!repeatEndDate) return false;
	return nextDate > repeatEndDate;
}
