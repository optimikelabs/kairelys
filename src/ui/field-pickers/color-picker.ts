import { t } from '../../core/i18n';
import { createButton, createFloatingPanel, requestFloatingInputFocus } from './common';

interface ColorPickerOptions {
	value?: string;
	onSelect: (value: string) => void;
	onClear?: () => void;
	onClose?: () => void;
}

export function showColorPicker(anchor: HTMLElement | DOMRect, options: ColorPickerOptions): () => void {
	let completed = false;
	const { panel, close } = createFloatingPanel(anchor, 'operon-floating-panel operon-color-picker-panel', () => {
		if (!completed) options.onClose?.();
	});

	const input = panel.createEl('input');
	input.type = 'color';
	input.className = 'operon-color-input';
	input.value = options.value ? (options.value.startsWith('#') ? options.value : `#${options.value}`) : '#000000';

	const actions = panel.createDiv('operon-floating-actions');

	if (options.onClear) {
		const clearButton = createButton(t('buttons', 'clear'), 'operon-floating-btn is-secondary', actions);
		clearButton.addEventListener('click', () => {
			completed = true;
			options.onClear?.();
			close();
		});
		actions.appendChild(clearButton);
	}

	const saveButton = createButton(t('buttons', 'apply'), 'operon-floating-btn', actions);
	saveButton.addEventListener('click', () => {
		completed = true;
		options.onSelect(input.value.replace(/^#/, ''));
		close();
	});
	actions.appendChild(saveButton);
	panel.appendChild(actions);

	requestFloatingInputFocus(input);
	return close;
}
