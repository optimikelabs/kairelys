import { Menu, Notice, Platform, setIcon } from 'obsidian';
import { isSpecialDynamicFilterSetId } from '../core/dynamic-file-task-filter';
import { t } from '../core/i18n';
import type { OperonSettings, FilterSet } from '../types/settings';
import type {
	RelatedFilterablePreset,
	RelatedPresetViewType,
	RelatedViewCreateGroup,
	RelatedViewCreateGroupKind,
	RelatedViewCreateTarget,
	RelatedViewFilteredCreateTarget,
	RelatedViewGroup,
	RelatedViewItem,
	RelatedViewOpenTarget,
	RelatedViewSource,
	RelatedViewType,
	RelatedViewUnfilteredCreateTarget,
} from '../types/related-views';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';

type RelatedViewSettings = Pick<
	OperonSettings,
	'calendarPresets' | 'kanbanPresets' | 'tablePresets' | 'filterSets'
>;

interface RelatedViewsLauncherOptions {
	container: HTMLElement;
	settings: RelatedViewSettings;
	source: RelatedViewSource;
	buttonClass?: string;
	closeBeforeOpen?: () => void;
	onOpenRelatedView?: (target: RelatedViewOpenTarget) => void | Promise<void>;
	onCreateRelatedView?: (target: RelatedViewCreateTarget) => void | Promise<void>;
}

export function buildRelatedViewGroups(
	settings: RelatedViewSettings,
	source: RelatedViewSource,
): RelatedViewGroup[] {
	const activeFilterSetId = resolveRelatedViewSourceFilterSetId(settings, source);
	if (activeFilterSetId === undefined) return [];
	const groups: RelatedViewGroup[] = [
		...(source.type === 'filter' ? [] : buildActiveFilterGroup(settings, activeFilterSetId)),
		{
			type: 'calendar',
			items: buildRelatedViewItems(settings, 'calendar', settings.calendarPresets, activeFilterSetId, source),
		},
		{
			type: 'kanban',
			items: buildRelatedViewItems(settings, 'kanban', settings.kanbanPresets, activeFilterSetId, source),
		},
		{
			type: 'table',
			items: buildRelatedViewItems(settings, 'table', settings.tablePresets, activeFilterSetId, source),
		},
	];
	return groups.filter(group => group.items.length > 0);
}

export function buildRelatedCreateGroups(
	settings: RelatedViewSettings,
	source: RelatedViewSource,
): RelatedViewCreateGroup[] {
	const activeFilterSetId = resolveRelatedViewSourceFilterSetId(settings, source);
	const groups: RelatedViewCreateGroup[] = [];
	if (activeFilterSetId) {
		groups.push({
			kind: 'with-filter',
			targets: buildCrossViewCreateTargets(settings, activeFilterSetId),
		});
	}
	const unfilteredTargets = buildUnfilteredCreateTargets(source);
	if (unfilteredTargets.length > 0) {
		groups.push({
			kind: 'without-filter',
			targets: unfilteredTargets,
		});
	}
	return groups;
}

export function buildTableRelatedViewGroups(
	settings: RelatedViewSettings,
	currentPreset: RelatedFilterablePreset,
): RelatedViewGroup[] {
	return buildRelatedViewGroups(settings, { type: 'table', preset: currentPreset });
}

export function buildTableRelatedCreateGroups(
	settings: RelatedViewSettings,
	currentPreset: RelatedFilterablePreset,
): RelatedViewCreateGroup[] {
	return buildRelatedCreateGroups(settings, { type: 'table', preset: currentPreset });
}

export function buildUniqueRelatedPresetName(
	baseName: string,
	presets: readonly { name: string }[],
): string {
	const rootName = baseName.trim() || baseName || 'Preset';
	const usedNames = new Set(presets
		.map(preset => normalizePresetNameForUniqueness(preset.name))
		.filter((name): name is string => !!name));
	const normalizedRootName = normalizePresetNameForUniqueness(rootName) ?? rootName.toLowerCase();
	if (!usedNames.has(normalizedRootName)) return rootName;
	for (let index = 2; ; index += 1) {
		const candidate = `${rootName} ${index}`;
		const normalizedCandidate = normalizePresetNameForUniqueness(candidate);
		if (!normalizedCandidate || !usedNames.has(normalizedCandidate)) return candidate;
	}
}

export function renderRelatedViewsLauncher(options: RelatedViewsLauncherOptions): HTMLButtonElement | null {
	if (!isRelatedViewsLauncherAvailable()) return null;
	const label = getRelatedViewsMenuLabel(options.settings, options.source);
	const buttonClasses = ['operon-related-views-button'];
	if (options.buttonClass) buttonClasses.unshift(options.buttonClass);
	const button = options.container.createEl('button', {
		cls: buttonClasses.join(' '),
		attr: {
			type: 'button',
			'aria-haspopup': 'menu',
			'aria-expanded': 'false',
		},
	});
	setAccessibleLabelWithoutTooltip(button, label);
	setIcon(button, 'external-link');
	if (!button.querySelector('svg')) {
		setIcon(button, 'square-arrow-out-up-right');
	}
	bindOperonHoverTooltip(button, {
		content: label,
		taskColor: null,
		preferredVertical: 'above',
	});
	button.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		showRelatedViewsMenu(button, options);
	});
	return button;
}

export function isRelatedViewsLauncherAvailable(): boolean {
	return !(Platform.isMobile || Platform.isMobileApp || Platform.isPhone || Platform.isTablet);
}

function showRelatedViewsMenu(anchor: HTMLElement, options: RelatedViewsLauncherOptions): void {
	options.closeBeforeOpen?.();
	const menu = new Menu();
	anchor.setAttribute('aria-expanded', 'true');
	menu.onHide(() => {
		anchor.setAttribute('aria-expanded', 'false');
	});
	const groups = buildRelatedViewGroups(options.settings, options.source);
	const createGroups = options.onCreateRelatedView
		? buildRelatedCreateGroups(options.settings, options.source)
		: [];
	let hasMenuContent = false;
	if (groups.length === 0) {
		if (resolveRelatedViewSourceFilterSetId(options.settings, options.source)) {
			menu.addItem(item => item
				.setTitle(t('table', 'relatedViewsEmpty'))
				.setIcon('info')
				.setDisabled(true));
			hasMenuContent = true;
		}
	} else {
		for (const [index, group] of groups.entries()) {
			if (index > 0) menu.addSeparator();
			menu.addItem(item => item
				.setTitle(getRelatedViewGroupLabel(group.type))
				.setIsLabel(true));
			for (const relatedView of group.items) {
				menu.addItem(item => item
					.setTitle(relatedView.name)
					.setIcon(getRelatedViewIcon(relatedView.type))
					.onClick(() => openRelatedView(options, relatedView)));
			}
		}
		hasMenuContent = true;
	}
	for (const createGroup of createGroups) {
		if (hasMenuContent) menu.addSeparator();
		menu.addItem(item => item
			.setTitle(getRelatedCreateGroupLabel(createGroup.kind))
			.setIsLabel(true));
		for (const createTarget of createGroup.targets) {
			menu.addItem(item => item
				.setTitle(getRelatedCreateLabel(createTarget))
				.setIcon(getRelatedCreateIcon(createTarget))
				.onClick(() => createRelatedView(options, createTarget)));
		}
		hasMenuContent = true;
	}
	menu.showAtPosition(getRelatedViewsMenuPosition(anchor), anchor.ownerDocument);
}

function getRelatedViewsMenuLabel(settings: RelatedViewSettings, source: RelatedViewSource): string {
	const hasActiveFilter = !!resolveRelatedViewSourceFilterSetId(settings, source);
	return t('table', hasActiveFilter ? 'relatedViewsMenuLabelWithFilter' : 'relatedViewsMenuLabel');
}

function getRelatedCreateGroupLabel(kind: RelatedViewCreateGroupKind): string {
	return t('table', kind === 'with-filter'
		? 'relatedViewsAddNewWithFilterGroup'
		: 'relatedViewsAddNewWithoutFilterGroup');
}

function openRelatedView(options: RelatedViewsLauncherOptions, relatedView: RelatedViewItem): void {
	void Promise.resolve(options.onOpenRelatedView?.({
		type: relatedView.type,
		presetId: relatedView.presetId,
	})).catch(error => {
		console.error('Operon: failed to open related view target', error);
		new Notice(t('table', 'relatedViewsOpenFailed'));
	});
}

function createRelatedView(options: RelatedViewsLauncherOptions, target: RelatedViewCreateTarget): void {
	void Promise.resolve(options.onCreateRelatedView?.(target)).catch(error => {
		console.error('Operon: failed to create related view target', error);
		new Notice(t('table', 'relatedViewsCreateFailed'));
	});
}

function getRelatedViewGroupLabel(type: RelatedViewType): string {
	if (type === 'filter') return t('table', 'filter');
	if (type === 'calendar') return t('table', 'relatedViewsCalendarGroup');
	if (type === 'kanban') return t('table', 'relatedViewsKanbanGroup');
	return t('table', 'relatedViewsTableGroup');
}

function getRelatedCreateLabel(target: RelatedViewCreateTarget): string {
	if (target.type === 'calendar' && target.variant === 'timeGrid') return t('table', 'relatedViewsNewCalendarTimeGrid');
	if (target.type === 'calendar' && target.variant === 'timeTrackerGrid') return t('table', 'relatedViewsNewCalendarTimeTrackerGrid');
	if (target.type === 'calendar' && target.variant === 'multiWeek') return t('table', 'relatedViewsNewCalendarMultiWeek');
	if (target.type === 'kanban') return t('table', 'relatedViewsNewKanbanDefaultPipeline');
	return t('table', 'relatedViewsNewTableDefaultTable');
}

function getRelatedCreateIcon(target: RelatedViewCreateTarget): string {
	if (target.type === 'calendar') return 'calendar-plus';
	if (target.type === 'kanban') return 'square-kanban';
	return 'table-2';
}

function getRelatedViewIcon(type: RelatedViewType): string {
	if (type === 'filter') return 'list-filter';
	if (type === 'calendar') return 'calendar-days';
	if (type === 'kanban') return 'square-kanban';
	return 'table-2';
}

function getRelatedViewsMenuPosition(anchor: HTMLElement): { x: number; y: number } {
	const rect = anchor.getBoundingClientRect();
	return { x: rect.left, y: rect.bottom + 4 };
}

function buildActiveFilterGroup(
	settings: RelatedViewSettings,
	filterSetId: string | null,
): RelatedViewGroup[] {
	if (!filterSetId) return [];
	const filterSet = settings.filterSets.find(entry => entry.id === filterSetId);
	if (!filterSet) return [];
	return [{
		type: 'filter',
		items: [{
			type: 'filter',
			presetId: filterSet.id,
			name: getFilterSetDisplayName(filterSet),
		}],
	}];
}

function resolveRelatedViewSourceFilterSetId(settings: RelatedViewSettings, source: RelatedViewSource): string | null | undefined {
	if (source.type === 'filter') {
		const filterSetId = source.preset.id.trim();
		if (!filterSetId) return undefined;
		if (isSpecialDynamicFilterSetId(filterSetId)) return undefined;
		return settings.filterSets.some(filterSet => filterSet.id === filterSetId) ? filterSetId : undefined;
	}
	return resolveRelatedViewPresetFilterSetId(settings, source.preset);
}

function getInheritedCreatePresetName(
	settings: RelatedViewSettings,
	filterSetId: string | null,
): { presetName?: string } {
	if (!filterSetId) return {};
	const filterSet = settings.filterSets.find(entry => entry.id === filterSetId);
	if (!filterSet) return {};
	return { presetName: getFilterSetDisplayName(filterSet) };
}

function buildCrossViewCreateTargets(
	settings: RelatedViewSettings,
	filterSetId: string,
): RelatedViewFilteredCreateTarget[] {
	const inheritedPresetName = getInheritedCreatePresetName(settings, filterSetId);
	return [
		{ type: 'calendar', variant: 'timeGrid', filterSetId, ...inheritedPresetName },
		{ type: 'calendar', variant: 'timeTrackerGrid', filterSetId, ...inheritedPresetName },
		{ type: 'calendar', variant: 'multiWeek', filterSetId, ...inheritedPresetName },
		{ type: 'kanban', variant: 'defaultPipeline', filterSetId, ...inheritedPresetName },
		{ type: 'table', variant: 'defaultTable', filterSetId, ...inheritedPresetName },
	];
}

function buildUnfilteredCreateTargets(source: RelatedViewSource): RelatedViewUnfilteredCreateTarget[] {
	if (source.type === 'calendar') {
		return [
			{ type: 'calendar', variant: 'timeGrid', filterSetId: null },
			{ type: 'calendar', variant: 'timeTrackerGrid', filterSetId: null },
			{ type: 'calendar', variant: 'multiWeek', filterSetId: null },
		];
	}
	if (source.type === 'kanban') {
		return [{ type: 'kanban', variant: 'defaultPipeline', filterSetId: null }];
	}
	if (source.type === 'table') {
		return [{ type: 'table', variant: 'defaultTable', filterSetId: null }];
	}
	return [];
}

function resolveRelatedViewPresetFilterSetId(settings: RelatedViewSettings, preset: RelatedFilterablePreset): string | null | undefined {
	const filterSetId = preset.filterSetId?.trim() || null;
	if (!filterSetId) return null;
	if (isSpecialDynamicFilterSetId(filterSetId)) return undefined;
	return settings.filterSets.some(filterSet => filterSet.id === filterSetId) ? filterSetId : null;
}

function buildRelatedViewItems(
	settings: RelatedViewSettings,
	type: RelatedPresetViewType,
	presets: readonly RelatedFilterablePreset[],
	filterSetId: string | null,
	source: RelatedViewSource,
): RelatedViewItem[] {
	return presets
		.filter(preset => !(source.type === type && preset.id === source.preset.id))
		.filter(preset => resolveRelatedViewPresetFilterSetId(settings, preset) === filterSetId)
		.map(preset => ({
			type,
			presetId: preset.id,
			name: getRelatedViewDisplayName(preset),
		}))
		.sort(compareRelatedViewItems);
}

function getRelatedViewDisplayName(preset: RelatedFilterablePreset): string {
	return preset.name.trim() || preset.id;
}

function getFilterSetDisplayName(filterSet: Pick<FilterSet, 'id' | 'name'>): string {
	return filterSet.name.trim() || filterSet.id;
}

function compareRelatedViewItems(left: RelatedViewItem, right: RelatedViewItem): number {
	return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

function normalizePresetNameForUniqueness(name: string): string | null {
	const trimmed = name.trim();
	return trimmed ? trimmed.toLowerCase() : null;
}
