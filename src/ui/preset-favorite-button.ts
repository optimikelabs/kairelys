import { setIcon } from 'obsidian';
import { t } from '../core/i18n';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';

export interface PresetFavoriteButtonOptions {
	containerEl: HTMLElement;
	active: boolean;
	disabled?: boolean;
	className?: string;
	onClick: () => void;
}

export function getPresetFavoriteActionLabel(active: boolean): string {
	return t('presetFavorites', active ? 'remove' : 'add');
}

export function createPresetFavoriteButton(options: PresetFavoriteButtonOptions): HTMLButtonElement {
	const label = getPresetFavoriteActionLabel(options.active);
	const button = options.containerEl.createEl('button', {
		cls: `operon-preset-favorite-button ${options.className ?? ''}`.trim(),
		attr: { type: 'button' },
	});
	setIcon(button, 'star');
	button.classList.toggle('is-active', options.active);
	button.setAttribute('aria-pressed', String(options.active));
	button.disabled = options.disabled === true;
	if (button.disabled) button.setAttribute('aria-disabled', 'true');
	setAccessibleLabelWithoutTooltip(button, label);
	bindOperonHoverTooltip(button, { content: label, taskColor: null });
	button.addEventListener('click', event => {
		event.preventDefault();
		if (button.disabled) return;
		options.onClick();
	});
	return button;
}
