import { setIcon } from 'obsidian';
import { bindOperonHoverTooltip } from '../operon-hover-tooltip';
import { settingsAsyncHandler } from './async-settings-action';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';

export interface SettingsListCardOptions {
	containerEl: HTMLElement;
	icon: string;
	title: string;
	className?: string;
	titleClassName?: string;
	metaClassName?: string;
	actionsClassName?: string;
	renderTitle?: (titleEl: HTMLElement) => void;
	renderMeta?: (metaEl: HTMLElement) => void;
}

export interface SettingsListCardChipOptions {
	containerEl: HTMLElement;
	icon?: string;
	label: string;
	className?: string;
}

export interface SettingsListCardActionOptions {
	containerEl: HTMLElement;
	label: string;
	ariaLabel?: string;
	tooltip?: string | null;
	icon?: string;
	text?: string;
	className?: string;
	disabled?: boolean;
	active?: boolean;
	danger?: boolean;
	monospace?: boolean;
	wide?: boolean;
	onClick?: () => void | Promise<void>;
	errorContext?: string;
}

export interface SettingsListCardHandle {
	cardEl: HTMLElement;
	iconEl: HTMLElement;
	mainEl: HTMLElement;
	titleEl: HTMLElement;
	metaEl: HTMLElement;
	actionsEl: HTMLElement;
}

function bindSettingsListTooltip(targetEl: HTMLElement, content: string): void {
	bindOperonHoverTooltip(targetEl, {
		content,
		taskColor: null,
	});
}

export function createSettingsListCard(options: SettingsListCardOptions): SettingsListCardHandle {
	const cardEl = options.containerEl.createDiv(`operon-settings-list-card ${options.className ?? ''}`.trim());

	const iconEl = cardEl.createSpan('operon-settings-list-card-icon');
	setIcon(iconEl, options.icon);

	const mainEl = cardEl.createDiv('operon-settings-list-card-main');
	const titleEl = mainEl.createSpan({
		cls: `operon-settings-list-card-title ${options.titleClassName ?? ''}`.trim(),
		text: options.title,
	});
	if (options.renderTitle) {
		titleEl.empty();
		options.renderTitle(titleEl);
	}
	const metaEl = mainEl.createDiv(`operon-settings-list-card-meta ${options.metaClassName ?? ''}`.trim());
	options.renderMeta?.(metaEl);
	const actionsEl = cardEl.createDiv(`operon-settings-list-card-actions ${options.actionsClassName ?? ''}`.trim());

	return { cardEl, iconEl, mainEl, titleEl, metaEl, actionsEl };
}

export function createSettingsListCardChip(options: SettingsListCardChipOptions): HTMLElement {
	const chipEl = options.containerEl.createSpan(`operon-settings-list-card-chip ${options.className ?? ''}`.trim());
	if (options.icon) {
		const iconEl = chipEl.createSpan('operon-settings-list-card-chip-icon');
		setIcon(iconEl, options.icon);
	}
	chipEl.createSpan({
		cls: 'operon-settings-list-card-chip-label',
		text: options.label,
	});
	return chipEl;
}

export function createSettingsListCardActionButton(options: SettingsListCardActionOptions): HTMLButtonElement {
	const classNames = [
		'operon-settings-list-card-action',
		options.className,
		options.wide ? 'is-wide' : null,
		options.active ? 'is-active' : null,
		options.danger ? 'is-danger' : null,
		options.monospace ? 'is-monospace' : null,
		options.disabled ? 'is-disabled' : null,
	].filter(Boolean).join(' ');
	const buttonEl = options.containerEl.createEl('button', {
		cls: classNames,
		attr: {
			type: 'button',
		},
	});
	if (options.tooltip !== null) {
		bindSettingsListTooltip(buttonEl, options.tooltip ?? options.label);
	}
	if (typeof options.active === 'boolean') {
		buttonEl.setAttribute('aria-pressed', String(options.active));
	}

	if (options.icon) {
		setIcon(buttonEl, options.icon);
	} else {
		buttonEl.setText(options.text ?? options.label);
	}
	if (options.text && options.icon) {
		buttonEl.createSpan({ text: options.text });
	}
	setAccessibleLabelWithoutTooltip(buttonEl, options.ariaLabel ?? options.label);
	if (options.disabled) {
		buttonEl.disabled = true;
		buttonEl.setAttribute('aria-disabled', 'true');
	}

	const onClick = options.onClick;
	if (onClick) {
		buttonEl.addEventListener('click', options.errorContext
			? settingsAsyncHandler(options.errorContext, async () => {
				if (buttonEl.disabled) return;
				await onClick();
			})
			: () => {
				if (buttonEl.disabled) return;
				void onClick();
			});
	}

	return buttonEl;
}
