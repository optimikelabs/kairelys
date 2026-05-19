import { App } from 'obsidian';
import { t } from '../core/i18n';
import { getAppLocale } from '../core/obsidian-app';
import { formatUiTime } from '../core/ui-time-format';
import { parseLocalDatetime } from '../systems/tracker-utils';
import { OperonSettings } from '../types/settings';

type TimeFormatSettings = Pick<OperonSettings, 'timeFormat'>;

export interface TrackerDayPart {
	label: string;
	icon: 'sunrise' | 'sun' | 'sunset' | 'moon-star' | 'moon';
}

export function formatTrackerDayHeader(app: App, dateKey: string): string {
	const date = parseLocalDatetime(`${dateKey}T00:00:00`);
	if (!date) return dateKey;

	const parts = new Intl.DateTimeFormat(getAppLocale(app), {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
	}).formatToParts(date);

	const weekday = parts.find(part => part.type === 'weekday')?.value;
	const day = parts.find(part => part.type === 'day')?.value;
	const month = parts.find(part => part.type === 'month')?.value;
	if (!weekday || !day || !month) return dateKey;
	return `${weekday} - ${day} ${month}`;
}

export function resolveTrackerDayPart(value: string): TrackerDayPart | null {
	const date = parseLocalDatetime(value);
	if (!date) return null;

	const minutes = date.getHours() * 60 + date.getMinutes();
	if (minutes >= 330 && minutes < 690) {
		return { label: t('taskEditor', 'trackerDayPartMorning'), icon: 'sunrise' };
	}
	if (minutes >= 690 && minutes < 1050) {
		return { label: t('taskEditor', 'trackerDayPartAfternoon'), icon: 'sun' };
	}
	if (minutes >= 1050 && minutes < 1350) {
		return { label: t('taskEditor', 'trackerDayPartEvening'), icon: 'sunset' };
	}
	if (minutes >= 1350 || minutes < 150) {
		return { label: t('taskEditor', 'trackerDayPartLateNight'), icon: 'moon-star' };
	}
	return { label: t('taskEditor', 'trackerDayPartNight'), icon: 'moon' };
}

export function formatTrackerSessionRange(
	app: App,
	settings: TimeFormatSettings,
	start: string,
	end: string,
): { icon: TrackerDayPart['icon'] | null; labelText: string; rangeText: string; fullText: string } {
	const rangeText = `${formatUiTime(app, settings, start)} - ${formatUiTime(app, settings, end)}`;
	const dayPart = resolveTrackerDayPart(start);
	if (!dayPart) {
		return {
			icon: null,
			labelText: '',
			rangeText,
			fullText: rangeText,
		};
	}

	const fullText = `${dayPart.label}, ${rangeText}`;
	return {
		icon: dayPart.icon,
		labelText: dayPart.label,
		rangeText,
		fullText,
	};
}

export function formatTrackerActiveRange(
	app: App,
	settings: TimeFormatSettings,
	start: string,
): { icon: TrackerDayPart['icon'] | null; labelText: string; timeText: string; fullText: string } {
	const timeText = `${formatUiTime(app, settings, start)} - ${t('taskEditor', 'trackerNow')}`;
	const dayPart = resolveTrackerDayPart(start);
	if (!dayPart) {
		return {
			icon: null,
			labelText: '',
			timeText,
			fullText: timeText,
		};
	}

	const fullText = `${dayPart.label}, ${timeText}`;
	return {
		icon: dayPart.icon,
		labelText: dayPart.label,
		timeText,
		fullText,
	};
}
