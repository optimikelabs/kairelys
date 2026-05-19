import { ButtonComponent, setIcon } from 'obsidian';

export interface SettingsTabDefinition<TTabId extends string> {
	id: TTabId;
	label: string;
	groupId?: TTabId;
	defaultTabId?: TTabId;
	icon?: string;
}

export interface SettingsTabFrameworkOptions<TTabId extends string> {
	containerEl: HTMLElement;
	activeTabId: TTabId;
	primaryTabs: SettingsTabDefinition<TTabId>[];
	secondaryTabs: SettingsTabDefinition<TTabId>[];
	renderTab: (tabId: TTabId, containerEl: HTMLElement) => void;
	onActiveTabChange: (tabId: TTabId) => void;
	focusActiveTab?: boolean;
}

function resolveTabGroupId<TTabId extends string>(tab: SettingsTabDefinition<TTabId>): TTabId {
	return tab.groupId ?? tab.id;
}

function toSettingsTabDomId<TTabId extends string>(prefix: string, tabId: TTabId): string {
	return `${prefix}-${tabId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

export function renderSettingsTabFramework<TTabId extends string>(
	options: SettingsTabFrameworkOptions<TTabId>,
): void {
	const allTabs = [...options.primaryTabs, ...options.secondaryTabs];
	const tabById = new Map<TTabId, SettingsTabDefinition<TTabId>>();
	for (const tab of allTabs) {
		tabById.set(tab.id, tab);
	}

	const fallbackTabId = options.primaryTabs[0]?.id ?? options.secondaryTabs[0]?.id;
	if (!fallbackTabId) return;

	const defaultTabByGroupId = new Map<TTabId, TTabId>();
	for (const tab of options.primaryTabs) {
		if (tab.defaultTabId) {
			defaultTabByGroupId.set(tab.id, tab.defaultTabId);
		}
	}

	let activeTabId = tabById.has(options.activeTabId)
		? options.activeTabId
		: fallbackTabId;

	options.containerEl.addClass('operon-settings-tab-root');
	const tabsEl = options.containerEl.createDiv('operon-settings-tabs');
	const navEl = tabsEl.createDiv('operon-settings-tab-nav');

	const primaryNavEl = navEl.createDiv('operon-settings-tab-nav-row operon-settings-tab-nav-primary');
	primaryNavEl.setAttribute('role', 'tablist');
	const secondaryNavEl = navEl.createDiv('operon-settings-tab-nav-row operon-settings-tab-nav-secondary');
	secondaryNavEl.setAttribute('role', 'tablist');
	const contentEl = tabsEl.createDiv('operon-settings-content');
	contentEl.id = toSettingsTabDomId('operon-settings-tabpanel', fallbackTabId);
	contentEl.setAttribute('role', 'tabpanel');
	contentEl.setAttribute('tabindex', '0');
	const tabButtons = new Map<TTabId, ButtonComponent>();

	const secondaryTabsByGroup = new Map<TTabId, SettingsTabDefinition<TTabId>[]>();
	for (const tab of options.secondaryTabs) {
		const groupId = resolveTabGroupId(tab);
		const groupTabs = secondaryTabsByGroup.get(groupId) ?? [];
		groupTabs.push(tab);
		secondaryTabsByGroup.set(groupId, groupTabs);
	}

	const resolveActivationTabId = (tabId: TTabId): TTabId => {
		const explicitDefaultTabId = defaultTabByGroupId.get(tabId);
		if (explicitDefaultTabId && tabById.has(explicitDefaultTabId)) {
			return explicitDefaultTabId;
		}
		const firstSecondaryTab = secondaryTabsByGroup.get(tabId)?.[0];
		return firstSecondaryTab?.id ?? tabId;
	};

	activeTabId = resolveActivationTabId(activeTabId);

	const updateNavigation = (): void => {
		const activeTab = tabById.get(activeTabId);
		const activeGroupId = activeTab ? resolveTabGroupId(activeTab) : activeTabId;
		const groupSecondaryTabs = secondaryTabsByGroup.get(activeGroupId) ?? [];
		secondaryNavEl.toggleClass('is-hidden', groupSecondaryTabs.length === 0);
		secondaryNavEl.toggleAttribute('hidden', groupSecondaryTabs.length === 0);
		secondaryNavEl.setAttribute('aria-hidden', groupSecondaryTabs.length === 0 ? 'true' : 'false');

		for (const tab of options.primaryTabs) {
			const button = tabButtons.get(tab.id);
			if (!button) continue;
			const isDirectActive = tab.id === activeTabId;
			const isGroupActive = tab.id === activeGroupId;
			button.buttonEl.toggleClass('is-active', isDirectActive);
			button.buttonEl.toggleClass('is-group-active', isGroupActive && !isDirectActive);
			button.buttonEl.setAttribute('aria-selected', isGroupActive ? 'true' : 'false');
			button.buttonEl.tabIndex = isGroupActive ? 0 : -1;
			button.removeCta();
		}

		for (const tab of options.secondaryTabs) {
			const button = tabButtons.get(tab.id);
			if (!button) continue;
			const tabGroupId = resolveTabGroupId(tab);
			const isVisible = tabGroupId === activeGroupId;
			const isActive = tab.id === activeTabId;
			button.buttonEl.toggleClass('is-hidden', !isVisible);
			button.buttonEl.toggleAttribute('hidden', !isVisible);
			button.buttonEl.toggleAttribute('inert', !isVisible);
			button.buttonEl.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
			button.buttonEl.toggleClass('is-active', isActive);
			button.buttonEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
			button.buttonEl.tabIndex = isVisible && isActive ? 0 : -1;
			button.removeCta();
		}
		const activeButton = tabButtons.get(activeTabId);
		if (activeButton) {
			contentEl.setAttribute('aria-labelledby', activeButton.buttonEl.id);
		}
	};

	const activateTab = (tabId: TTabId, focus = false, focusTabId?: TTabId): void => {
		const nextTabId = resolveActivationTabId(tabId);
		if (!tabById.has(nextTabId)) return;
		activeTabId = nextTabId;
		options.onActiveTabChange(nextTabId);
		contentEl.empty();
		options.renderTab(nextTabId, contentEl);
		updateNavigation();
		if (focus) {
			tabButtons.get(focusTabId ?? nextTabId)?.buttonEl.focus();
		}
	};

	const getVisibleTabIds = (kind: 'primary' | 'secondary'): TTabId[] => {
		const sourceTabs = kind === 'primary' ? options.primaryTabs : options.secondaryTabs;
		return sourceTabs
			.filter(tab => {
				const button = tabButtons.get(tab.id);
				return button !== undefined && !button.buttonEl.hidden;
			})
			.map(tab => tab.id);
	};

	const renderButton = (
		containerEl: HTMLElement,
		tab: SettingsTabDefinition<TTabId>,
		kind: 'primary' | 'secondary',
	): void => {
		const button = new ButtonComponent(containerEl);
		button.setButtonText(tab.label);
		if (tab.icon) {
			const iconEl = button.buttonEl.createSpan('operon-settings-tab-icon');
			setIcon(iconEl, tab.icon);
			button.buttonEl.prepend(iconEl);
		}
		button.removeCta();
		button.buttonEl.addClass('operon-settings-tab-btn');
		button.buttonEl.addClass(kind === 'primary'
			? 'operon-settings-tab-btn-primary'
			: 'operon-settings-tab-btn-secondary');
		button.buttonEl.id = toSettingsTabDomId('operon-settings-tab', tab.id);
		button.buttonEl.setAttribute('type', 'button');
		button.buttonEl.setAttribute('role', 'tab');
		button.buttonEl.setAttribute('aria-selected', 'false');
		button.buttonEl.setAttribute('aria-controls', contentEl.id);
		button.buttonEl.tabIndex = -1;
		button.onClick(() => {
			const nextTabId = resolveActivationTabId(tab.id);
			activateTab(nextTabId, nextTabId !== tab.id);
		});
		button.buttonEl.addEventListener('keydown', event => {
			const visibleTabIds = getVisibleTabIds(kind);
			const currentIndex = visibleTabIds.indexOf(tab.id);
			if (currentIndex < 0) return;
			if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
				event.preventDefault();
				const nextTabId = visibleTabIds[(currentIndex + 1) % visibleTabIds.length];
				activateTab(nextTabId, true, kind === 'primary' ? nextTabId : undefined);
			} else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
				event.preventDefault();
				const previousTabId = visibleTabIds[(currentIndex - 1 + visibleTabIds.length) % visibleTabIds.length];
				activateTab(previousTabId, true, kind === 'primary' ? previousTabId : undefined);
			} else if (event.key === 'Home') {
				event.preventDefault();
				activateTab(visibleTabIds[0], true, kind === 'primary' ? visibleTabIds[0] : undefined);
			} else if (event.key === 'End') {
				event.preventDefault();
				const lastTabId = visibleTabIds[visibleTabIds.length - 1];
				activateTab(lastTabId, true, kind === 'primary' ? lastTabId : undefined);
			}
		});
		tabButtons.set(tab.id, button);
	};

	for (const tab of options.primaryTabs) {
		renderButton(primaryNavEl, tab, 'primary');
	}
	for (const tab of options.secondaryTabs) {
		renderButton(secondaryNavEl, tab, 'secondary');
	}

	activateTab(resolveActivationTabId(activeTabId), options.focusActiveTab === true);
}
