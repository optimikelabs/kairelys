import { isPresetFavorite, type PresetFavorites } from '../../core/preset-favorites';
import type { KanbanPreset } from '../../types/kanban';

export function isFavoriteKanbanPreset(preset: KanbanPreset, favorites: PresetFavorites): boolean {
	return isPresetFavorite(favorites, 'kanban', preset.id);
}

export interface KanbanPresetPickerButtonState {
	hasActiveNonFavoritePreset: boolean;
	tooltip: string;
}

export function resolveKanbanPresetPickerButtonState(
	preset: KanbanPreset,
	favorites: PresetFavorites,
	defaultTooltip: string,
	activePresetLabel: string,
): KanbanPresetPickerButtonState {
	const hasActiveNonFavoritePreset = !isFavoriteKanbanPreset(preset, favorites);
	return {
		hasActiveNonFavoritePreset,
		tooltip: hasActiveNonFavoritePreset ? activePresetLabel : defaultTooltip,
	};
}

export function getFavoriteKanbanPresets(
	presets: readonly KanbanPreset[],
	favorites: PresetFavorites,
): KanbanPreset[] {
	return presets.filter(preset => isFavoriteKanbanPreset(preset, favorites));
}
