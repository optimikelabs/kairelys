import { isPresetFavorite, type PresetFavorites } from '../../core/preset-favorites';
import type { TablePreset } from '../../types/table';

export function isFavoriteTablePreset(preset: TablePreset, favorites: PresetFavorites): boolean {
	return isPresetFavorite(favorites, 'table', preset.id);
}

export interface TablePresetPickerButtonState {
	hasActiveNonFavoritePreset: boolean;
	tooltip: string;
}

export function resolveTablePresetPickerButtonState(
	preset: TablePreset,
	favorites: PresetFavorites,
	defaultTooltip: string,
	activePresetLabel: string,
): TablePresetPickerButtonState {
	const hasActiveNonFavoritePreset = !isFavoriteTablePreset(preset, favorites);
	return {
		hasActiveNonFavoritePreset,
		tooltip: hasActiveNonFavoritePreset ? activePresetLabel : defaultTooltip,
	};
}

export function getFavoriteTablePresets(
	presets: readonly TablePreset[],
	favorites: PresetFavorites,
): TablePreset[] {
	return presets.filter(preset => isFavoriteTablePreset(preset, favorites));
}
