import { Setting, setIcon } from 'obsidian';
import { bindOperonHoverTooltip } from '../operon-hover-tooltip';
import { settingsAsyncHandler } from './async-settings-action';
import {
	createSettingsListCard,
	createSettingsListCardActionButton,
	createSettingsListCardChip,
} from './settings-list-ui';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';

export interface InterfaceIconToggleButtonOptions {
	containerEl: HTMLElement;
	icon: string;
	label: string;
	className: string;
	active?: boolean;
	disabled?: boolean;
	locked?: boolean;
	tooltip?: string;
	pressed?: boolean | null;
	onClick?: () => void | Promise<void>;
	errorContext?: string;
}

export interface InterfaceIconToggleSectionItem<TKey extends string> {
	key: TKey;
	visible: boolean;
	iconOnly?: boolean;
}

export interface InterfaceIconActionToggle {
	visible: boolean;
	icon: string;
	label: string;
	onToggle: () => Promise<void>;
}

export interface InterfaceIconToggleSectionOptions<
	TKey extends string,
	TItem extends InterfaceIconToggleSectionItem<TKey>,
> {
	containerEl: HTMLElement;
	layout?: 'legacy' | 'row-list';
	description: string;
	toggleTitle: string;
	iconOnlyTitle?: string;
	reorderTitle: string;
	moveUpLabel: string;
	moveDownLabel: string;
	getItems: () => TItem[];
	setItems: (items: TItem[]) => void;
	getLabel: (key: TKey) => string;
	getIcon: (key: TKey) => string;
	save: () => Promise<void>;
	getActionToggles?: () => InterfaceIconActionToggle[];
	actionTogglesTitle?: string;
	iconOnlyButtonLabel?: string;
	getCanonicalLabel?: (key: TKey) => string;
	getVisibilityToggleLabel?: (label: string) => string;
	getIconOnlyToggleLabel?: (label: string) => string;
	visibilityErrorContext: string;
	iconOnlyErrorContext: string;
	actionErrorContext: string;
}

export interface InterfaceMatrixButtonOptions {
	containerEl: HTMLElement;
	icon: string;
	label: string;
	className: string;
	tooltip?: string;
	active?: boolean;
	locked?: boolean;
	lockedTooltip?: string;
	onClick?: () => void | Promise<void>;
	errorContext?: string;
}

export interface InterfaceMatrixHeaderIconOptions {
	containerEl: HTMLElement;
	icon: string;
	label: string;
	className: string;
	tooltip?: string;
}

function bindInterfaceTooltip(targetEl: HTMLElement, content: string): void {
	bindOperonHoverTooltip(targetEl, {
		content,
		taskColor: null,
	});
}

function applyExtraButtonTooltip(button: { extraSettingsEl?: HTMLElement }, content: string): void {
	if (!button.extraSettingsEl) return;
	setAccessibleLabelWithoutTooltip(button.extraSettingsEl, content);
	bindInterfaceTooltip(button.extraSettingsEl, content);
}

function moveInterfaceItem<TItem extends object>(
	items: TItem[],
	fromIndex: number,
	toIndex: number,
): TItem[] {
	const next = items.map(item => ({ ...item }));
	const [moved] = next.splice(fromIndex, 1);
	if (!moved) return next;
	next.splice(toIndex, 0, moved);
	return next;
}

export function createInterfaceIconToggleButton(options: InterfaceIconToggleButtonOptions): HTMLButtonElement {
	const buttonEl = options.containerEl.createEl('button', {
		cls: `operon-interface-icon-toggle-button ${options.className}`.trim(),
		attr: {
			type: 'button',
		},
	});
	setIcon(buttonEl, options.icon);
	setAccessibleLabelWithoutTooltip(buttonEl, options.label);
	bindInterfaceTooltip(buttonEl, options.tooltip ?? options.label);

	if (options.active) buttonEl.addClass('is-active');
	if (options.disabled) buttonEl.addClass('is-disabled');
	if (options.locked) {
		buttonEl.addClass('is-locked');
		buttonEl.setAttribute('aria-disabled', 'true');
	}
	if (options.pressed !== null) {
		buttonEl.setAttribute('aria-pressed', String(options.pressed ?? options.active === true));
	}
	if (options.disabled) {
		buttonEl.disabled = true;
		buttonEl.setAttribute('aria-disabled', 'true');
	}

	const onClick = options.onClick;
	if (onClick && !options.disabled && !options.locked) {
		buttonEl.addEventListener('click', settingsAsyncHandler(options.errorContext ?? 'settings interface action failed', async () => {
			await onClick();
		}));
	}

	return buttonEl;
}

export function renderInterfaceIconToggleSection<
	TKey extends string,
	TItem extends InterfaceIconToggleSectionItem<TKey>,
>(options: InterfaceIconToggleSectionOptions<TKey, TItem>): void {
	if (options.layout === 'row-list') {
		renderInterfaceIconRowListSection(options);
		return;
	}

	const description = options.containerEl.createEl('p', {
		text: options.description,
	});
	description.addClass('operon-settings-section-desc');

	const section = options.containerEl.createDiv('operon-settings-task-creator-toolbar');
	const toggleLabel = section.createDiv('operon-settings-task-creator-toolbar-label');
	toggleLabel.setText(options.toggleTitle);
	const toggleGrid = section.createDiv('operon-settings-task-creator-toolbar-grid');

	let iconOnlyGrid: HTMLElement | null = null;
	if (options.iconOnlyTitle) {
		const iconOnlyLabel = section.createDiv('operon-settings-task-creator-toolbar-label');
		iconOnlyLabel.setText(options.iconOnlyTitle);
		iconOnlyGrid = section.createDiv('operon-settings-task-creator-toolbar-grid');
	}

	const reorderDetails = section.createEl('details', {
		cls: 'operon-settings-task-creator-toolbar-reorder',
	});
	const reorderSummary = reorderDetails.createEl('summary', {
		text: options.reorderTitle,
	});
	reorderSummary.addClass('operon-settings-task-creator-toolbar-summary');
	const reorderList = reorderDetails.createDiv('operon-settings-task-creator-toolbar-reorder-list');

	const renderRows = (): void => {
		const items = options.getItems();
		toggleGrid.empty();
		iconOnlyGrid?.empty();
		reorderList.empty();

		items.forEach((item, index) => {
			const label = options.getLabel(item.key);
			const icon = options.getIcon(item.key);
			createInterfaceIconToggleButton({
				containerEl: toggleGrid,
				icon,
				label,
				className: 'operon-settings-task-creator-toolbar-icon',
				active: item.visible,
				pressed: item.visible,
				errorContext: options.visibilityErrorContext,
				onClick: async () => {
					options.setItems(items.map((entry, entryIndex) =>
						entryIndex === index ? { ...entry, visible: !entry.visible } : entry,
					));
					await options.save();
					renderRows();
				},
			});

			if (iconOnlyGrid) {
				createInterfaceIconToggleButton({
					containerEl: iconOnlyGrid,
					icon,
					label,
					className: 'operon-settings-task-creator-toolbar-icon',
					active: item.iconOnly === true,
					disabled: !item.visible,
					pressed: item.iconOnly === true,
					errorContext: options.iconOnlyErrorContext,
					onClick: async () => {
						if (!item.visible) return;
						options.setItems(items.map((entry, entryIndex) =>
							entryIndex === index ? { ...entry, iconOnly: !entry.iconOnly } : entry,
						));
						await options.save();
						renderRows();
					},
				});
			}

			const setting = new Setting(reorderList)
				.setName(label);
			setting.settingEl.addClass('operon-interface-icon-reorder-row');

			setting.addExtraButton(button => {
				button.setIcon('arrow-up');
				applyExtraButtonTooltip(button, options.moveUpLabel);
				button.setDisabled(index === 0);
				button.onClick(async () => {
					if (index === 0) return;
					options.setItems(moveInterfaceItem(items, index, index - 1));
					await options.save();
					renderRows();
				});
			});

			setting.addExtraButton(button => {
				button.setIcon('arrow-down');
				applyExtraButtonTooltip(button, options.moveDownLabel);
				button.setDisabled(index === items.length - 1);
				button.onClick(async () => {
					if (index >= items.length - 1) return;
					options.setItems(moveInterfaceItem(items, index, index + 1));
					await options.save();
					renderRows();
				});
			});
		});

		for (const action of options.getActionToggles?.() ?? []) {
			createInterfaceIconToggleButton({
				containerEl: toggleGrid,
				icon: action.icon,
				label: action.label,
				className: 'operon-settings-task-creator-toolbar-icon',
				active: action.visible,
				pressed: action.visible,
				errorContext: options.actionErrorContext,
				onClick: async () => {
					await action.onToggle();
					renderRows();
				},
			});
		}
	};

	renderRows();
}

function renderInterfaceIconRowListSection<
	TKey extends string,
	TItem extends InterfaceIconToggleSectionItem<TKey>,
>(options: InterfaceIconToggleSectionOptions<TKey, TItem>): void {
	const description = options.containerEl.createEl('p', {
		text: options.description,
	});
	description.addClass('operon-settings-section-desc');

	const sectionEl = options.containerEl.createDiv('operon-compact-chip-row-editor');
	const listEl = sectionEl.createDiv('operon-compact-chip-row-list');
	const actionListEl = sectionEl.createDiv('operon-compact-chip-action-list');
	const showIconOnlyToggle = !!options.iconOnlyTitle || !!options.iconOnlyButtonLabel;
	const iconOnlyButtonLabel = options.iconOnlyButtonLabel ?? 'Icon Only';

	const renderRows = (): void => {
		const items = options.getItems();
		listEl.empty();
		actionListEl.empty();

		items.forEach((item, index) => {
			const label = options.getLabel(item.key);
			const icon = options.getIcon(item.key);
			const row = createSettingsListCard({
				containerEl: listEl,
				icon,
				title: label,
				className: 'operon-compact-chip-row',
				metaClassName: 'operon-compact-chip-row-meta',
				actionsClassName: 'operon-compact-chip-row-actions',
				renderMeta: metaEl => {
					createSettingsListCardChip({
						containerEl: metaEl,
						label: options.getCanonicalLabel?.(item.key) ?? item.key,
						className: 'operon-compact-chip-canonical-chip',
					});
				},
			});

			createSettingsListCardActionButton({
				containerEl: row.actionsEl,
				label: options.moveUpLabel,
				tooltip: options.moveUpLabel,
				icon: 'arrow-up',
				disabled: index === 0,
				errorContext: options.visibilityErrorContext,
				onClick: async () => {
					if (index === 0) return;
					options.setItems(moveInterfaceItem(items, index, index - 1));
					await options.save();
					renderRows();
				},
			});

			createSettingsListCardActionButton({
				containerEl: row.actionsEl,
				label: options.moveDownLabel,
				tooltip: options.moveDownLabel,
				icon: 'arrow-down',
				disabled: index >= items.length - 1,
				errorContext: options.visibilityErrorContext,
				onClick: async () => {
					if (index >= items.length - 1) return;
					options.setItems(moveInterfaceItem(items, index, index + 1));
					await options.save();
					renderRows();
				},
			});

			if (showIconOnlyToggle) {
				createSettingsListCardActionButton({
					containerEl: row.actionsEl,
					label: iconOnlyButtonLabel,
					ariaLabel: options.getIconOnlyToggleLabel?.(label) ?? `${iconOnlyButtonLabel}: ${label}`,
					tooltip: options.getIconOnlyToggleLabel?.(label) ?? `${iconOnlyButtonLabel}: ${label}`,
					text: iconOnlyButtonLabel,
					active: item.iconOnly === true,
					disabled: !item.visible,
					wide: true,
					className: 'operon-compact-chip-icon-only-toggle',
					errorContext: options.iconOnlyErrorContext,
					onClick: async () => {
						if (!item.visible) return;
						options.setItems(items.map((entry, entryIndex) =>
							entryIndex === index ? { ...entry, iconOnly: !entry.iconOnly } : entry,
						));
						await options.save();
						renderRows();
					},
				});
			}

			createSettingsListCardActionButton({
				containerEl: row.actionsEl,
				label: options.getVisibilityToggleLabel?.(label) ?? label,
				ariaLabel: options.getVisibilityToggleLabel?.(label) ?? label,
				tooltip: options.getVisibilityToggleLabel?.(label) ?? label,
				icon,
				active: item.visible,
				className: 'operon-compact-chip-visibility-toggle',
				errorContext: options.visibilityErrorContext,
				onClick: async () => {
					options.setItems(items.map((entry, entryIndex) =>
						entryIndex === index ? { ...entry, visible: !entry.visible } : entry,
					));
					await options.save();
					renderRows();
				},
			});
		});

		const actions = options.getActionToggles?.() ?? [];
		if (actions.length > 0) {
			actionListEl.createDiv({
				text: options.actionTogglesTitle ?? '',
				cls: 'operon-compact-chip-action-title',
			});
		}
		for (const action of actions) {
			const row = createSettingsListCard({
				containerEl: actionListEl,
				icon: action.icon,
				title: action.label,
				className: 'operon-compact-chip-action-row',
				actionsClassName: 'operon-compact-chip-row-actions',
			});
			createSettingsListCardActionButton({
				containerEl: row.actionsEl,
				label: options.getVisibilityToggleLabel?.(action.label) ?? action.label,
				ariaLabel: options.getVisibilityToggleLabel?.(action.label) ?? action.label,
				tooltip: options.getVisibilityToggleLabel?.(action.label) ?? action.label,
				icon: action.icon,
				active: action.visible,
				className: 'operon-compact-chip-visibility-toggle',
				errorContext: options.actionErrorContext,
				onClick: async () => {
					await action.onToggle();
					renderRows();
				},
			});
		}
	};

	renderRows();
}

export function createInterfaceMatrixButton(options: InterfaceMatrixButtonOptions): HTMLButtonElement {
	return createInterfaceIconToggleButton({
		containerEl: options.containerEl,
		icon: options.locked ? 'lock' : options.icon,
		label: options.label,
		className: options.className,
			active: options.active === true && options.locked !== true,
			locked: options.locked,
			tooltip: options.locked ? options.lockedTooltip : options.tooltip ?? options.label,
			pressed: options.active === true && options.locked !== true,
			errorContext: options.errorContext,
			onClick: options.locked ? undefined : options.onClick,
		});
}

export function createInterfaceMatrixHeaderIcon(options: InterfaceMatrixHeaderIconOptions): HTMLElement {
	const iconEl = options.containerEl.createSpan({
		cls: options.className,
		attr: {
			role: 'img',
		},
	});
	setIcon(iconEl, options.icon);
	setAccessibleLabelWithoutTooltip(iconEl, options.label);
	bindInterfaceTooltip(iconEl, options.tooltip ?? options.label);
	return iconEl;
}
