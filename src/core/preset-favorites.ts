export const PRESET_FAVORITE_KINDS = ['table', 'calendar', 'kanban', 'filter'] as const;

export type PresetFavoriteKind = typeof PRESET_FAVORITE_KINDS[number];

export interface PresetFavorites {
	table: string[];
	calendar: string[];
	kanban: string[];
	filter: string[];
}

export interface PresetFavoriteDefaultIds {
	table: string | null;
	calendar: string | null;
	kanban: string | null;
}

export function createEmptyPresetFavorites(): PresetFavorites {
	return {
		table: [],
		calendar: [],
		kanban: [],
		filter: [],
	};
}

export function createDefaultPresetFavorites(defaultIds: PresetFavoriteDefaultIds): PresetFavorites {
	return {
		table: defaultIds.table ? [defaultIds.table] : [],
		calendar: defaultIds.calendar ? [defaultIds.calendar] : [],
		kanban: defaultIds.kanban ? [defaultIds.kanban] : [],
		filter: [],
	};
}

export function clonePresetFavorites(favorites: PresetFavorites): PresetFavorites {
	return {
		table: [...favorites.table],
		calendar: [...favorites.calendar],
		kanban: [...favorites.kanban],
		filter: [...favorites.filter],
	};
}

export function normalizePresetFavorites(value: unknown, fallback: PresetFavorites): PresetFavorites {
	if (!isRecord(value)) return clonePresetFavorites(fallback);
	return {
		table: normalizeFavoriteIds(value.table),
		calendar: normalizeFavoriteIds(value.calendar),
		kanban: normalizeFavoriteIds(value.kanban),
		filter: normalizeFavoriteIds(value.filter),
	};
}

export function isPresetFavorite(
	favorites: PresetFavorites,
	kind: PresetFavoriteKind,
	presetId: string,
): boolean {
	const normalizedId = presetId.trim();
	return normalizedId.length > 0 && favorites[kind].includes(normalizedId);
}

export function togglePresetFavorite(
	favorites: PresetFavorites,
	kind: PresetFavoriteKind,
	presetId: string,
): PresetFavorites {
	const normalizedId = presetId.trim();
	if (!normalizedId) return clonePresetFavorites(favorites);
	const next = clonePresetFavorites(favorites);
	const ids = next[kind];
	const index = ids.indexOf(normalizedId);
	if (index === -1) {
		ids.push(normalizedId);
	} else {
		ids.splice(index, 1);
	}
	return next;
}

export function removePresetFavorite(
	favorites: PresetFavorites,
	kind: PresetFavoriteKind,
	presetId: string,
): PresetFavorites {
	const normalizedId = presetId.trim();
	if (!normalizedId) return clonePresetFavorites(favorites);
	const next = clonePresetFavorites(favorites);
	next[kind] = next[kind].filter(id => id !== normalizedId);
	return next;
}

function normalizeFavoriteIds(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const ids: string[] = [];
	for (const entry of value) {
		const id = typeof entry === 'string' ? entry.trim() : '';
		if (!id || seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
