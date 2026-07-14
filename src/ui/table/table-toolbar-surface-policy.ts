export type TableToolbarSurface =
	| 'workspace-leaf'
	| 'file-leaf'
	| 'page-preview'
	| 'markdown-embed';

export interface TableToolbarSurfacePolicy {
	titleSource: 'surface' | 'preset';
	showFavoritePresets: boolean;
	showPresetPicker: boolean;
	showRelatedViews: boolean;
	showExport: boolean;
	settingsManagementMode: 'full' | 'current-only';
}

export function resolveTableToolbarSurfacePolicy(
	_surface: TableToolbarSurface,
): TableToolbarSurfacePolicy {
	return {
		titleSource: 'surface',
		showFavoritePresets: true,
		showPresetPicker: true,
		showRelatedViews: true,
		showExport: true,
		settingsManagementMode: 'full',
	};
}
