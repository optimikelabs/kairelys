import { setIcon } from 'obsidian';
import { bindOperonHoverTooltip } from '../operon-hover-tooltip';
import { settingsAsyncHandler } from './async-settings-action';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';

export interface SettingsUtilitySectionOptions {
	containerEl: HTMLElement;
	heading: string;
	description?: string;
	className?: string;
	addButtonLabel?: string;
	addButtonClassName?: string;
	onAdd?: () => void | Promise<void>;
	addErrorContext?: string;
}

export interface SettingsUtilitySectionHandle {
	sectionEl: HTMLElement;
	headingEl: HTMLElement;
	descriptionEl: HTMLElement | null;
	listEl: HTMLElement;
	addRowEl: HTMLElement;
	addButtonEl: HTMLButtonElement | null;
}

export interface SettingsUtilityRowOptions {
	containerEl: HTMLElement;
	className?: string;
	missing?: boolean;
}

export interface SettingsUtilityRowHandle {
	rowEl: HTMLElement;
	pickerCellEl: HTMLElement;
	inputCellEl: HTMLElement;
	actionsEl: HTMLElement;
}

export interface SettingsUtilityPickerButtonOptions {
	containerEl: HTMLElement;
	label: string;
	ariaLabel?: string;
	tooltip?: string;
	className?: string;
	missing?: boolean;
	ariaDisabled?: boolean;
	disabled?: boolean;
	onClick?: () => void | Promise<void>;
	errorContext?: string;
}

export interface SettingsUtilityTextInputOptions {
	containerEl: HTMLElement;
	value: string;
	placeholder: string;
	ariaLabel?: string;
	className?: string;
	disabled?: boolean;
	onChange?: (inputEl: HTMLInputElement) => void | Promise<void>;
	errorContext?: string;
}

export interface SettingsUtilityIconActionButtonOptions {
	containerEl: HTMLElement;
	label: string;
	icon: string;
	tooltip?: string;
	className?: string;
	disabled?: boolean;
	danger?: boolean;
	onClick?: () => void | Promise<void>;
	errorContext?: string;
}

function joinClasses(...classes: Array<string | null | undefined | false>): string {
	return classes.filter(Boolean).join(' ');
}

function bindUtilityTooltip(targetEl: HTMLElement, content: string): void {
	bindOperonHoverTooltip(targetEl, {
		content,
		taskColor: null,
	});
}

function bindOptionalAsyncClick(
	buttonEl: HTMLButtonElement,
	onClick: (() => void | Promise<void>) | undefined,
	errorContext: string | undefined,
): void {
	if (!onClick) return;
	const handler = async (): Promise<void> => {
		if (buttonEl.disabled) return;
		await onClick();
	};
	buttonEl.addEventListener('click', errorContext
		? settingsAsyncHandler(errorContext, handler)
		: () => {
			void handler();
		});
}

export function createSettingsUtilitySection(options: SettingsUtilitySectionOptions): SettingsUtilitySectionHandle {
	const sectionEl = options.containerEl.createDiv(joinClasses('operon-settings-utility-section', options.className));
	const headingEl = sectionEl.createDiv({
		cls: 'operon-settings-utility-heading',
		text: options.heading,
	});
	const descriptionEl = options.description
		? sectionEl.createDiv({
			cls: 'operon-settings-utility-desc',
			text: options.description,
		})
		: null;
	const listEl = sectionEl.createDiv('operon-settings-utility-list');
	const addRowEl = sectionEl.createDiv('operon-settings-utility-add-row');
	const addButtonEl = options.addButtonLabel
		? addRowEl.createEl('button', {
			cls: joinClasses('mod-cta operon-settings-utility-add-button', options.addButtonClassName),
			text: options.addButtonLabel,
			attr: { type: 'button' },
		})
		: null;

	if (addButtonEl) {
		bindOptionalAsyncClick(addButtonEl, options.onAdd, options.addErrorContext);
	}

	return { sectionEl, headingEl, descriptionEl, listEl, addRowEl, addButtonEl };
}

export function createSettingsUtilityEmptyState(containerEl: HTMLElement, text: string): HTMLElement {
	return containerEl.createDiv({
		cls: 'operon-settings-utility-empty',
		text,
	});
}

export function createSettingsUtilityRow(options: SettingsUtilityRowOptions): SettingsUtilityRowHandle {
	const rowEl = options.containerEl.createDiv(joinClasses('operon-settings-utility-row', options.className));
	if (options.missing) rowEl.addClass('is-missing');
	const pickerCellEl = rowEl.createDiv('operon-settings-utility-picker-cell');
	const inputCellEl = rowEl.createDiv('operon-settings-utility-input-cell');
	const actionsEl = rowEl.createDiv('operon-settings-utility-actions');
	return { rowEl, pickerCellEl, inputCellEl, actionsEl };
}

export function createSettingsUtilityPickerButton(options: SettingsUtilityPickerButtonOptions): HTMLButtonElement {
	const buttonEl = options.containerEl.createEl('button', {
		cls: joinClasses(
			'operon-settings-utility-picker',
			options.className,
			options.missing ? 'is-missing' : null,
		),
		text: options.label,
		attr: {
			type: 'button',
		},
	});
	setAccessibleLabelWithoutTooltip(buttonEl, options.ariaLabel ?? options.label);
	if (options.tooltip) bindUtilityTooltip(buttonEl, options.tooltip);
	if (options.ariaDisabled) buttonEl.setAttribute('aria-disabled', 'true');
	if (options.disabled) {
		buttonEl.disabled = true;
		buttonEl.setAttribute('aria-disabled', 'true');
		buttonEl.addClass('is-disabled');
	}
	bindOptionalAsyncClick(buttonEl, options.onClick, options.errorContext);
	return buttonEl;
}

export function createSettingsUtilityMeta(containerEl: HTMLElement, text: string, missing = false): HTMLElement {
	const metaEl = containerEl.createDiv({
		cls: joinClasses('operon-settings-utility-meta', missing ? 'is-missing' : null),
		text,
	});
	return metaEl;
}

export function createSettingsUtilityTextInput(options: SettingsUtilityTextInputOptions): HTMLInputElement {
	const inputEl = options.containerEl.createEl('input', {
		cls: joinClasses('operon-settings-utility-input', options.className),
		attr: {
			type: 'text',
		},
	});
	setAccessibleLabelWithoutTooltip(inputEl, options.ariaLabel ?? options.placeholder);
	inputEl.placeholder = options.placeholder;
	inputEl.value = options.value;
	inputEl.disabled = options.disabled === true;
	if (options.disabled) inputEl.addClass('is-disabled');
	if (options.onChange) {
		inputEl.addEventListener('change', settingsAsyncHandler(
			options.errorContext ?? 'settings utility input change failed',
			async () => options.onChange?.(inputEl),
		));
	}
	return inputEl;
}

export function createSettingsUtilityIconActionButton(options: SettingsUtilityIconActionButtonOptions): HTMLButtonElement {
	const buttonEl = options.containerEl.createEl('button', {
		cls: joinClasses(
			'clickable-icon operon-settings-utility-action',
			options.className,
			options.danger ? 'is-danger' : null,
		),
		attr: {
			type: 'button',
		},
	});
	setIcon(buttonEl, options.icon);
	setAccessibleLabelWithoutTooltip(buttonEl, options.label);
	bindUtilityTooltip(buttonEl, options.tooltip ?? options.label);
	if (options.disabled) {
		buttonEl.disabled = true;
		buttonEl.setAttribute('aria-disabled', 'true');
		buttonEl.addClass('is-disabled');
	}
	bindOptionalAsyncClick(buttonEl, options.onClick, options.errorContext);
	return buttonEl;
}
