import { App, Modal } from 'obsidian';
import { t } from '../../core/i18n';
import {
	CalendarFilterFieldChange,
	CalendarUnsupportedFilterCondition,
} from '../../types/calendar';

export type FilterMaterializationModalResult = 'confirm' | 'cancel' | 'back';

export interface FilterMaterializationModalOptions {
	title: string;
	message: string;
	confirmText: string;
	cancelText?: string;
	backText: string;
	scheduleChanges?: Array<{ label: string; before: string; after: string }>;
	additions?: CalendarFilterFieldChange[];
	updates?: CalendarFilterFieldChange[];
	unsupportedConditions?: CalendarUnsupportedFilterCondition[];
}

export class FilterMaterializationModal extends Modal {
	private readonly options: FilterMaterializationModalOptions;
	private readonly onCloseResult: (result: FilterMaterializationModalResult) => void;
	private resolved = false;

	constructor(
		app: App,
		options: FilterMaterializationModalOptions,
		onCloseResult: (result: FilterMaterializationModalResult) => void,
	) {
		super(app);
		this.options = options;
		this.onCloseResult = onCloseResult;
	}

	onOpen(): void {
		const { contentEl } = this;
		this.modalEl.addClass('operon-calendar-filter-materialization-modal');
		contentEl.empty();
		this.titleEl.setText(this.options.title);
		contentEl.createEl('p', { text: this.options.message });

		this.renderScheduleChanges(contentEl);
		this.renderFieldChangeSection(contentEl, t('calendar', 'materializationAdditions'), this.options.additions ?? [], false);
		this.renderFieldChangeSection(contentEl, t('calendar', 'materializationUpdates'), this.options.updates ?? [], true);
		this.renderWarnings(contentEl);

		const footer = contentEl.createDiv('operon-calendar-filter-materialization-footer');
		const left = footer.createDiv('operon-calendar-filter-materialization-footer-left');
		const right = footer.createDiv('operon-calendar-filter-materialization-footer-right');

		const backButton = left.createEl('button', { text: this.options.backText });
		backButton.addEventListener('click', () => this.finish('back'));

		const cancelButton = right.createEl('button', { text: this.options.cancelText ?? t('buttons', 'cancel') });
		cancelButton.addEventListener('click', () => this.finish('cancel'));

		const confirmButton = right.createEl('button', { text: this.options.confirmText });
		confirmButton.addClass('mod-cta');
		confirmButton.addEventListener('click', () => this.finish('confirm'));
		window.setTimeout(() => confirmButton.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) {
			this.onCloseResult('cancel');
		}
	}

	private finish(result: FilterMaterializationModalResult): void {
		this.resolved = true;
		this.close();
		this.onCloseResult(result);
	}

	private renderScheduleChanges(container: HTMLElement): void {
		const rows = this.options.scheduleChanges ?? [];
		if (rows.length === 0) return;
		const section = container.createDiv('operon-calendar-filter-materialization-section');
		section.createEl('h4', {
			text: t('calendar', 'materializationScheduleChanges'),
			cls: 'operon-calendar-filter-materialization-heading',
		});
		const table = section.createDiv('operon-calendar-filter-materialization-table');
		for (const row of rows) {
			const item = table.createDiv('operon-calendar-filter-materialization-row');
			item.createDiv({
				cls: 'operon-calendar-filter-materialization-label',
				text: row.label,
			});
			item.createDiv({
				cls: 'operon-calendar-filter-materialization-before',
				text: row.before,
			});
			item.createDiv({
				cls: 'operon-calendar-filter-materialization-after',
				text: row.after,
			});
		}
	}

	private renderFieldChangeSection(
		container: HTMLElement,
		title: string,
		rows: CalendarFilterFieldChange[],
		includeBeforeAfter: boolean,
	): void {
		if (rows.length === 0) return;
		const section = container.createDiv('operon-calendar-filter-materialization-section');
		section.createEl('h4', {
			text: title,
			cls: 'operon-calendar-filter-materialization-heading',
		});
		const table = section.createDiv('operon-calendar-filter-materialization-table');
		for (const row of rows) {
			const item = table.createDiv('operon-calendar-filter-materialization-row');
			item.createDiv({
				cls: 'operon-calendar-filter-materialization-label',
				text: row.label,
			});
			if (includeBeforeAfter) {
				item.createDiv({
					cls: 'operon-calendar-filter-materialization-before',
					text: row.currentValue?.trim() || '—',
				});
				item.createDiv({
					cls: 'operon-calendar-filter-materialization-after',
					text: row.nextValue,
				});
				} else {
					item.createDiv({
						cls: 'operon-calendar-filter-materialization-value operon-calendar-filter-materialization-value-full',
						text: row.nextValue,
					});
				}
		}
	}

	private renderWarnings(container: HTMLElement): void {
		const warnings = this.options.unsupportedConditions ?? [];
		if (warnings.length === 0) return;
		const section = container.createDiv('operon-calendar-filter-materialization-section');
		section.createEl('h4', {
			text: t('calendar', 'materializationUnsupportedConditions'),
			cls: 'operon-calendar-filter-materialization-heading',
		});
		const list = section.createEl('ul', { cls: 'operon-calendar-filter-materialization-warning-list' });
		for (const warning of warnings) {
			const item = list.createEl('li');
			item.createEl('strong', { text: `${warning.summary}: ` });
			item.createSpan({ text: warning.reason });
		}
	}
}
