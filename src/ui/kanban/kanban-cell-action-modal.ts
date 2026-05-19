import { App, Modal } from 'obsidian';
import { t } from '../../core/i18n';
import { KanbanCellActionContext, KanbanCellActionId } from '../../types/kanban';
import { getOwnerDocument, getOwnerWindow } from '../../core/dom-compat';

export interface KanbanCellActionOption {
	id: KanbanCellActionId;
	label: string;
	iconLabel: string;
	disabled?: boolean;
	disabledReason?: string;
}

export interface KanbanCellActionModalOptions {
	context: KanbanCellActionContext;
	actions?: KanbanCellActionId[];
	inlineTaskEnabled: boolean;
	inlineTaskDisabledReason?: string;
	onChooseAction: (actionId: KanbanCellActionId) => void;
	onCancel?: () => void;
}

export function buildKanbanCellActionOptions(
	options: Pick<KanbanCellActionModalOptions, 'actions' | 'inlineTaskEnabled' | 'inlineTaskDisabledReason'>,
): KanbanCellActionOption[] {
	const allowedActions = new Set<KanbanCellActionId>(options.actions ?? ['pickTask', 'createFileTask', 'createInlineTask']);
	const allActions: KanbanCellActionOption[] = [
		{
			id: 'pickTask',
			label: t('buttons', 'searchPlaceTask'),
			iconLabel: 'Ex',
		},
		{
			id: 'createFileTask',
			label: t('buttons', 'createFileTask'),
			iconLabel: 'Fi',
		},
		{
			id: 'createInlineTask',
			label: t('buttons', 'createInlineTask'),
			iconLabel: 'In',
			disabled: !options.inlineTaskEnabled,
			disabledReason: !options.inlineTaskEnabled
				? (options.inlineTaskDisabledReason ?? t('notifications', 'dailyNoteUnavailable'))
				: undefined,
		},
	];
	return allActions.filter(action => allowedActions.has(action.id));
}

export function formatKanbanCellSelectionLabel(context: KanbanCellActionContext): string {
	const parts = [
		`${t('taskEditor', 'status')}: ${context.targetStatusLabel}`,
	];
	if (context.swimlaneBy) {
		parts.push(`${formatSwimlaneLabel(context.swimlaneBy)}: ${context.targetLaneLabel}`);
	}
	return parts.join(' • ');
}

export class KanbanCellActionModal extends Modal {
	private readonly options: KanbanCellActionModalOptions;
	private readonly actions: KanbanCellActionOption[];
	private buttons: HTMLButtonElement[] = [];
	private resolved = false;

	constructor(app: App, options: KanbanCellActionModalOptions) {
		super(app);
		this.options = options;
		this.actions = buildKanbanCellActionOptions(options);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.modalEl.addClass('operon-kanban-cell-action-modal');
		contentEl.empty();
		this.titleEl.setText(t('modals', 'addToKanbanCell'));
		contentEl.createDiv({
			cls: 'operon-calendar-slot-action-selection',
			text: formatKanbanCellSelectionLabel(this.options.context),
		});

		const list = contentEl.createDiv('operon-calendar-slot-action-list');
		this.buttons = this.actions.map(action => {
			const button = list.createEl('button', {
				cls: 'operon-calendar-slot-action-button',
				attr: {
					type: 'button',
					'data-action-id': action.id,
				},
			});
			button.disabled = action.disabled === true;
			const topRow = button.createDiv('operon-calendar-slot-action-top-row');
			const iconWrap = topRow.createDiv('operon-calendar-slot-action-icon');
			iconWrap.setText(action.iconLabel);
			topRow.createDiv({
				cls: 'operon-calendar-slot-action-label',
				text: action.label,
			});
			if (action.disabledReason) {
				button.createDiv({
					cls: 'operon-calendar-slot-action-disabled-reason',
					text: action.disabledReason,
				});
			}
			button.addEventListener('click', () => {
				if (action.disabled) return;
				this.finish(action.id);
			});
			return button;
		});

			contentEl.addEventListener('keydown', this.handleKeydown);
			const initialButton = this.buttons.find(button => !button.disabled) ?? this.buttons[0];
			getOwnerWindow(contentEl).setTimeout(() => initialButton?.focus(), 0);
	}

	onClose(): void {
		this.contentEl.removeEventListener('keydown', this.handleKeydown);
		this.contentEl.empty();
		if (!this.resolved) {
			this.options.onCancel?.();
		}
	}

	private readonly handleKeydown = (event: KeyboardEvent): void => {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
			return;
		}
		event.preventDefault();
		const enabledButtons = this.buttons.filter(button => !button.disabled);
		if (enabledButtons.length === 0) return;

		const activeElement = getOwnerDocument(this.contentEl).activeElement as HTMLButtonElement | null;
		const currentIndex = Math.max(0, enabledButtons.indexOf(activeElement ?? enabledButtons[0]));
		let nextIndex = currentIndex;

		if (event.key === 'ArrowDown') nextIndex = Math.min(enabledButtons.length - 1, currentIndex + 1);
		if (event.key === 'ArrowUp') nextIndex = Math.max(0, currentIndex - 1);
		if (event.key === 'Home') nextIndex = 0;
		if (event.key === 'End') nextIndex = enabledButtons.length - 1;

		enabledButtons[nextIndex]?.focus();
	};

	private finish(actionId: KanbanCellActionId): void {
		this.resolved = true;
		this.close();
		this.options.onChooseAction(actionId);
	}
}

function formatSwimlaneLabel(swimlaneBy: KanbanCellActionContext['swimlaneBy']): string {
	switch (swimlaneBy) {
		case 'priority':
		case 'tags':
		case 'contexts':
		case 'assignees':
		case 'dateDue':
		case 'dateScheduled':
			return t('settings', `kanbanSwimlane_${swimlaneBy}`);
		default:
			return t('settings', 'kanbanSwimlane_lane');
	}
}
