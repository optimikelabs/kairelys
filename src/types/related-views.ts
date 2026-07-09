export type RelatedViewType = 'filter' | 'calendar' | 'kanban' | 'table';
export type RelatedPresetViewType = Exclude<RelatedViewType, 'filter'>;

export interface RelatedFilterablePreset {
	id: string;
	name: string;
	filterSetId: string | null;
}

export interface RelatedFilterSourcePreset {
	id: string;
	name: string;
}

export type RelatedViewSource =
	| { type: 'filter'; preset: RelatedFilterSourcePreset }
	| { type: RelatedPresetViewType; preset: RelatedFilterablePreset };

export type RelatedViewCreateTarget =
	| { type: 'calendar'; variant: 'timeGrid' | 'timeTrackerGrid' | 'multiWeek'; filterSetId: string | null; presetName?: string }
	| { type: 'kanban'; variant: 'defaultPipeline'; filterSetId: string | null; presetName?: string }
	| { type: 'table'; variant: 'defaultTable'; filterSetId: string | null; presetName?: string };

export interface RelatedViewOpenTarget {
	type: RelatedViewType;
	presetId: string;
}

export interface RelatedViewItem extends RelatedViewOpenTarget {
	name: string;
}

export interface RelatedViewGroup {
	type: RelatedViewType;
	items: RelatedViewItem[];
}
