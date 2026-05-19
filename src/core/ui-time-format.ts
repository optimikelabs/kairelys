import { App } from 'obsidian';
import { parseLocalDatetime } from '../systems/tracker-utils';
import { OperonSettings } from '../types/settings';
import { getAppLocale } from './obsidian-app';

type TimeFormatSettings = Pick<OperonSettings, 'timeFormat'>;

export function formatUiTimestamp(app: App, settings: TimeFormatSettings, value: string): string {
	const date = parseLocalDatetime(value);
	if (!date) return value;
	return new Intl.DateTimeFormat(getAppLocale(app), {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		hour12: settings.timeFormat === '12h',
	}).format(date);
}

export function formatUiTime(app: App, settings: TimeFormatSettings, value: string): string {
	const date = parseLocalDatetime(value);
	if (!date) return value;
	return new Intl.DateTimeFormat(getAppLocale(app), {
		hour: 'numeric',
		minute: '2-digit',
		hour12: settings.timeFormat === '12h',
	}).format(date);
}
