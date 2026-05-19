import { t } from '../../core/i18n';
import { createButton, createFloatingPanel, focusFloatingInput } from './common';

export interface EstimatePickerOptions {
	value?: string;
	onSelect: (value: string) => void;
	onRemove?: () => void;
	canRemove?: boolean;
	onCancel?: () => void;
	onClose?: () => void;
}

export function showEstimatePicker(anchor: HTMLElement | DOMRect, options: EstimatePickerOptions): () => void {
	let completed = false;
	const { panel, close } = createFloatingPanel(anchor, 'operon-floating-panel operon-estimate-picker-panel', () => {
		if (!completed) options.onCancel?.();
		options.onClose?.();
	});

	const title = panel.createDiv('operon-floating-subtitle');
	title.textContent = t('taskEditor', 'estimateMinutes');

	const input = panel.createEl('input');
	input.type = 'number';
	input.min = '1';
	input.step = '1';
	input.className = 'operon-floating-input operon-estimate-picker-input';
	const initialSeconds = Number.parseInt(options.value ?? '0', 10);
	input.value = initialSeconds > 0 ? String(Math.round(initialSeconds / 60)) : '';

	const actions = panel.createDiv('operon-floating-actions');

	if (options.onRemove && options.canRemove) {
		const removeButton = createButton(t('taskEditor', 'datetimeRemove'), 'operon-floating-btn is-secondary', actions);
		removeButton.addEventListener('click', () => {
			completed = true;
			options.onRemove?.();
			close();
		});
		actions.appendChild(removeButton);
	}

	const applyButton = createButton(t('buttons', 'save'), 'operon-floating-btn', actions);
	actions.appendChild(applyButton);
	panel.appendChild(actions);

	const commit = () => {
		const minutes = Number.parseInt(input.value, 10);
		if (!Number.isFinite(minutes) || minutes <= 0) return;
		completed = true;
		options.onSelect(String(minutes * 60));
		close();
	};

	applyButton.addEventListener('click', commit);
	input.addEventListener('keydown', event => {
		if (event.key === 'Enter') {
			event.preventDefault();
			commit();
		}
	});

	window.requestAnimationFrame(() => {
		focusFloatingInput(input);
		input.select();
	});

	return close;
}
