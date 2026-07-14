import { t } from '../../core/i18n';
import type { KanbanPreset } from '../../types/kanban';
import { showSearchableFieldPicker, type SearchableFieldPickerOption } from '../field-pickers/searchable-field-picker';

export interface KanbanPresetPickerOption extends SearchableFieldPickerOption {
	field: string;
	label: string;
	icon: string;
	preset: KanbanPreset;
}

interface ShowKanbanPresetPickerOptions {
	value: string | null | undefined;
	presets: readonly KanbanPreset[];
	onSelect: (presetId: string, preset: KanbanPreset) => void;
	onClose?: () => void;
	floatingHost?: HTMLElement;
	floatingScrollHost?: HTMLElement | Window;
	matchWidth?: number;
}

export function getKanbanPresetPickerLabel(preset: KanbanPreset, index = 0): string {
	return preset.name.trim() || t('settings', 'kanbanFallbackPresetName', { number: String(index + 1) });
}

export function buildKanbanPresetPickerOptions(presets: readonly KanbanPreset[]): KanbanPresetPickerOption[] {
	return presets.map((preset, index) => ({
		field: preset.id,
		label: getKanbanPresetPickerLabel(preset, index),
		icon: 'square-kanban',
		preset,
	}));
}

export function showKanbanPresetPicker(
	anchor: HTMLElement | DOMRect,
	options: ShowKanbanPresetPickerOptions,
): () => void {
	return showSearchableFieldPicker(anchor, {
		value: options.value,
		fields: buildKanbanPresetPickerOptions(options.presets),
		placeholder: t('tooltips', 'searchKanbanPresets'),
		ariaLabel: t('tooltips', 'selectKanbanPreset'),
		noMatchesText: t('tooltips', 'noMatchingKanbanPresets'),
		onSelect: option => options.onSelect(option.field, option.preset),
		onClose: options.onClose,
		variantClassName: 'operon-kanban-preset-picker',
		floatingHost: options.floatingHost,
		floatingScrollHost: options.floatingScrollHost,
		matchWidth: options.matchWidth,
		repositionOnScroll: true,
		repositionOnWindowResize: true,
	});
}
