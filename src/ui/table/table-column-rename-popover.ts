import { t } from '../../core/i18n';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import {
	createFloatingPanel,
	requestFloatingInputFocus,
	type FloatingHostOptions,
} from '../field-pickers/common';

export interface TableColumnRenamePopoverOptions extends FloatingHostOptions {
	anchor: HTMLElement;
	initialValue: string;
	placeholder: string;
	onSubmit: (label: string) => void;
	onClose?: () => void;
}

export function showTableColumnRenamePopover(options: TableColumnRenamePopoverOptions): () => void {
	let submitted = false;
	const { panel, close: closePanel } = createFloatingPanel(
		options.anchor,
		'operon-floating-panel operon-table-column-rename-popover',
		options.onClose,
		{
			focusInputSelector: '.operon-table-column-rename-input',
			floatingHost: options.floatingHost,
			floatingScrollHost: options.floatingScrollHost,
			constrainToFloatingHost: options.constrainToFloatingHost,
			repositionOnScroll: true,
			repositionOnWindowResize: true,
			shouldClose: reason => reason !== 'window-blur',
		},
	);

	panel.setAttribute('role', 'dialog');
	setAccessibleLabelWithoutTooltip(panel, t('table', 'renameColumnTitle'));
	panel.createDiv({
		cls: 'operon-table-column-rename-title',
		text: t('table', 'renameColumnTitle'),
	});

	const field = panel.createEl('label', { cls: 'operon-table-column-rename-field' });
	field.createSpan({
		cls: 'operon-table-column-rename-label',
		text: t('table', 'columnName'),
	});
	const input = field.createEl('input', {
		cls: 'operon-table-column-rename-input',
		attr: {
			type: 'text',
			placeholder: options.placeholder,
		},
	});
	input.value = options.initialValue;
	setAccessibleLabelWithoutTooltip(input, t('table', 'columnName'));

	const submit = (): void => {
		if (submitted) return;
		submitted = true;
		const label = input.value.trim();
		closePanel();
		options.onSubmit(label);
	};
	input.addEventListener('keydown', event => {
		if (event.key !== 'Enter' || event.isComposing) return;
		event.preventDefault();
		submit();
	});

	const actions = panel.createDiv('operon-table-column-rename-actions');
	const cancelButton = actions.createEl('button', {
		cls: 'operon-table-column-rename-button is-cancel',
		text: t('buttons', 'cancel'),
		attr: { type: 'button' },
	});
	cancelButton.addEventListener('click', () => closePanel());
	const saveButton = actions.createEl('button', {
		cls: 'operon-table-column-rename-button is-save mod-cta',
		text: t('buttons', 'save'),
		attr: { type: 'button' },
	});
	saveButton.addEventListener('click', submit);

	requestFloatingInputFocus(input);
	const ownerWindow = panel.ownerDocument.defaultView ?? window;
	ownerWindow.requestAnimationFrame(() => {
		if (input.isConnected && panel.ownerDocument.activeElement === input) input.select();
	});

	return closePanel;
}
