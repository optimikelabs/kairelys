import { setIcon } from 'obsidian';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';

export interface SettingsCollapsibleCardAction {
	type: 'icon' | 'text';
	label: string;
	icon?: string;
	disabled?: boolean;
	className?: string;
	onClick: (event: MouseEvent) => void | Promise<void>;
}

export interface SettingsCollapsibleCardOptions {
	containerEl: HTMLElement;
	cardId: string;
	title: string;
	subtitle?: string;
	isOpen: boolean;
	actions?: SettingsCollapsibleCardAction[];
	onToggle: (isOpen: boolean) => void;
}

export interface SettingsCollapsibleCardHandle {
	cardEl: HTMLElement;
	titleEl: HTMLElement;
	subtitleEl: HTMLElement;
	bodyInnerEl: HTMLElement;
}

function toSettingsDomId(prefix: string, id: string): string {
	return `${prefix}-${id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

export function createSettingsCollapsibleCard(options: SettingsCollapsibleCardOptions): SettingsCollapsibleCardHandle {
	const card = options.containerEl.createDiv('operon-settings-preset-card');
	if (options.isOpen) card.addClass('is-open');

	const header = card.createDiv('operon-settings-preset-card-header');
	const disclosure = header.createEl('button', {
		cls: 'operon-settings-preset-card-disclosure',
		attr: {
			type: 'button',
			'aria-expanded': options.isOpen ? 'true' : 'false',
		},
	});
	const chevron = disclosure.createDiv('operon-settings-preset-card-chevron');
	setIcon(chevron, 'chevron-right');

	const titleWrap = disclosure.createDiv('operon-settings-preset-card-title');
	const titleEl = titleWrap.createDiv('operon-settings-preset-card-title-main');
	titleEl.setText(options.title);
	const subtitleEl = titleWrap.createDiv({ cls: 'operon-settings-preset-card-title-sub', text: options.subtitle ?? '' });

	const actionGroup = header.createDiv('operon-settings-preset-card-actions');
	for (const action of options.actions ?? []) {
		const button = actionGroup.createEl('button', {
			cls: action.className ?? (
				action.type === 'icon'
					? 'operon-settings-preset-card-icon-button'
					: 'operon-settings-preset-card-remove'
			),
			attr: {
				type: 'button',
			},
		});
		if (action.type === 'text') {
			button.setText(action.label);
		}
		if (action.type === 'icon' && action.icon) {
			setIcon(button, action.icon);
		}
		setAccessibleLabelWithoutTooltip(button, action.label);
		button.disabled = action.disabled === true;
		button.addEventListener('click', event => {
			event.stopPropagation();
			void action.onClick(event);
		});
	}

	const body = card.createDiv('operon-settings-preset-card-body');
	body.id = toSettingsDomId('operon-settings-preset-card-body', options.cardId);
	body.toggleAttribute('inert', !options.isOpen);
	body.setAttribute('aria-hidden', options.isOpen ? 'false' : 'true');
	disclosure.setAttribute('aria-controls', body.id);
	const bodyInnerEl = body.createDiv('operon-settings-preset-card-body-inner');

	disclosure.addEventListener('click', () => {
		const opening = !card.hasClass('is-open');
		card.toggleClass('is-open', opening);
		disclosure.setAttribute('aria-expanded', opening ? 'true' : 'false');
		body.toggleAttribute('inert', !opening);
		body.setAttribute('aria-hidden', opening ? 'false' : 'true');
		options.onToggle(opening);
	});

	return {
		cardEl: card,
		titleEl,
		subtitleEl,
		bodyInnerEl,
	};
}
