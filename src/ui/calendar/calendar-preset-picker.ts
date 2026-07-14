import { t } from '../../core/i18n';
import type { CalendarPreset } from '../../types/calendar';
import { showSearchableFieldPicker, type SearchableFieldPickerOption } from '../field-pickers/searchable-field-picker';

export interface CalendarPresetPickerOption extends SearchableFieldPickerOption {
	field: string;
	label: string;
	icon: string;
	preset: CalendarPreset;
}

interface ShowCalendarPresetPickerOptions {
	value: string | null | undefined;
	presets: readonly CalendarPreset[];
	onSelect: (presetId: string, preset: CalendarPreset) => void;
	onClose?: () => void;
	floatingHost?: HTMLElement;
	floatingScrollHost?: HTMLElement | Window;
	matchWidth?: number;
}

export function getCalendarPresetPickerLabel(preset: Pick<CalendarPreset, 'name'>, index = 0): string {
	return preset.name.trim() || t('calendar', 'presetFallbackName', { number: String(index + 1) });
}

export function buildCalendarPresetPickerOptions(presets: readonly CalendarPreset[]): CalendarPresetPickerOption[] {
	return presets.map((preset, index) => ({
		field: preset.id,
		label: getCalendarPresetPickerLabel(preset, index),
		icon: 'calendar-days',
		preset,
	}));
}

export function showCalendarPresetPicker(
	anchor: HTMLElement | DOMRect,
	options: ShowCalendarPresetPickerOptions,
): () => void {
	return showSearchableFieldPicker(anchor, {
		value: options.value,
		fields: buildCalendarPresetPickerOptions(options.presets),
		placeholder: t('tooltips', 'searchCalendarPresets'),
		ariaLabel: t('tooltips', 'selectCalendarPreset'),
		noMatchesText: t('tooltips', 'noMatchingCalendarPresets'),
		onSelect: option => options.onSelect(option.field, option.preset),
		onClose: options.onClose,
		variantClassName: 'operon-calendar-preset-picker',
		floatingHost: options.floatingHost,
		floatingScrollHost: options.floatingScrollHost,
		matchWidth: options.matchWidth,
		closeOnWindowResize: false,
		repositionOnScroll: true,
		repositionOnWindowResize: true,
	});
}
