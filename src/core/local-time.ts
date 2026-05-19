/**
 * Local time utilities for Operon.
 * All user-facing timestamps use local time, NOT UTC.
 *
 * Format: YYYY-MM-DDTHH:MM:SS (no timezone suffix, no milliseconds)
 * Date-only: YYYY-MM-DD
 */

/**
 * Get current local datetime as ISO-like string without timezone.
 * Example: "2026-03-01T17:44:32"
 */
export function localNow(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Get current local date as YYYY-MM-DD.
 * Example: "2026-03-01"
 */
export function localToday(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Convert a Date object to local ISO-like datetime string.
 */
export function toLocalDatetime(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Convert a Date object to local date string YYYY-MM-DD.
 */
export function toLocalDate(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
