export interface ParsedTrackerSession {
	start: string;
	end: string;
	raw: string;
	durationSeconds: number;
}

const LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;
const DATETIME_LOCAL_WITH_OPTIONAL_SECONDS_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?$/;

export function parseLocalDatetime(value: string): Date | null {
	const match = LOCAL_DATETIME_RE.exec(value.trim());
	if (!match) return null;

	const [, year, month, day, hour, minute, second] = match;
	return new Date(
		Number(year),
		Number(month) - 1,
		Number(day),
		Number(hour),
		Number(minute),
		Number(second),
		0,
	);
}

export function toDatetimeLocalValue(value: string | undefined | null): string {
	if (!value) return '';
	const trimmed = value.trim();
	return LOCAL_DATETIME_RE.test(trimmed) ? trimmed : '';
}

export function fromDatetimeLocalValue(value: string | undefined | null): string {
	if (!value) return '';
	const trimmed = value.trim();
	const match = DATETIME_LOCAL_WITH_OPTIONAL_SECONDS_RE.exec(trimmed);
	if (!match) return '';
	return `${match[1]}:${match[2] ?? '00'}`;
}

export function normalizeActiveTrackerValue(value: string | undefined | null): string {
	if (!value) return '';
	const trimmed = value.trim();
	if (!trimmed) return '';
	const slashIndex = trimmed.indexOf('/');
	return slashIndex === -1 ? trimmed : trimmed.substring(0, slashIndex).trim();
}

export function buildTrackerRange(start: string, end: string): string {
	return `${start}/${end}`;
}

function formatLocalDatetime(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hour = String(date.getHours()).padStart(2, '0');
	const minute = String(date.getMinutes()).padStart(2, '0');
	const second = String(date.getSeconds()).padStart(2, '0');
	return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function getNextLocalMidnight(date: Date): Date {
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate() + 1,
		0,
		0,
		0,
		0,
	);
}

export function splitTrackerRangeByMidnight(start: string, end: string): Array<{ start: string; end: string }> {
	const startDate = parseLocalDatetime(start);
	const endDate = parseLocalDatetime(end);
	if (!startDate || !endDate || endDate.getTime() <= startDate.getTime()) {
		return [{ start, end }];
	}

	const fragments: Array<{ start: string; end: string }> = [];
	let cursor = startDate;

	while (cursor.getTime() < endDate.getTime()) {
		const nextMidnight = getNextLocalMidnight(cursor);
		const fragmentEnd = nextMidnight.getTime() < endDate.getTime() ? nextMidnight : endDate;
		fragments.push({
			start: formatLocalDatetime(cursor),
			end: formatLocalDatetime(fragmentEnd),
		});
		cursor = fragmentEnd;
	}

	return fragments.length > 0 ? fragments : [{ start, end }];
}

export function parseTrackerRange(raw: string): ParsedTrackerSession | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	const [start, end] = trimmed.split('/').map(part => part.trim());
	if (!start || !end) return null;

	const startDate = parseLocalDatetime(start);
	const endDate = parseLocalDatetime(end);
	if (!startDate || !endDate) return null;

	const durationSeconds = Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / 1000));
	return {
		start,
		end,
		raw: buildTrackerRange(start, end),
		durationSeconds,
	};
}

export function parseTrackerList(value: string | undefined | null): ParsedTrackerSession[] {
	if (!value?.trim()) return [];
	return value
		.split(';')
		.map(part => parseTrackerRange(part))
		.filter((session): session is ParsedTrackerSession => !!session);
}

export function serializeTrackerList(
	sessions: Array<{ start: string; end: string } | string>,
): string {
	return sessions
		.map(session => typeof session === 'string' ? session.trim() : buildTrackerRange(session.start, session.end))
		.filter(Boolean)
		.join('; ');
}

export function calculateDurationFromTrackers(value: string | undefined | null): number {
	return parseTrackerList(value).reduce((sum, session) => sum + session.durationSeconds, 0);
}

export function formatDurationClock(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = total % 60;
	return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatDurationHuman(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = total % 60;

	if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
	if (minutes > 0) return `${minutes}m ${secs}s`;
	return `${secs}s`;
}

export function isLocalDateInRange(dateValue: string, rangeDays: number, now: Date = new Date()): boolean {
	const sessionDate = parseLocalDatetime(`${dateValue}T00:00:00`);
	if (!sessionDate) return false;

	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
	const oldest = new Date(today);
	oldest.setDate(today.getDate() - Math.max(0, rangeDays - 1));
	return sessionDate.getTime() >= oldest.getTime() && sessionDate.getTime() <= today.getTime();
}
