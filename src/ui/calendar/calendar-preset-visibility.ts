import { isPresetFavorite, type PresetFavorites } from '../../core/preset-favorites';
import type { CalendarPreset } from '../../types/calendar';

export function isFavoriteCalendarPreset(preset: Pick<CalendarPreset, 'id'>, favorites: PresetFavorites): boolean {
	return isPresetFavorite(favorites, 'calendar', preset.id);
}

export function getFavoriteCalendarPresets(
	presets: readonly CalendarPreset[],
	favorites: PresetFavorites,
): CalendarPreset[] {
	return presets.filter(preset => isFavoriteCalendarPreset(preset, favorites));
}
