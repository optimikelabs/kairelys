import { App, Modal } from 'obsidian';
import { LocaleData } from '../core/i18n';
import { t } from '../core/i18n';
import { FieldRenameProgressSnapshot } from '../core/field-rename-migration';

export interface FieldRenameProgressModalCopy {
	title: string;
	intro: string;
	stopped: string;
	fileTasks: string;
	inlineTasks: string;
	files: string;
	reindexing: string;
	finished: string;
	finishedIntro: string;
	updating: string;
	failedCountCategory: keyof LocaleData;
	failedCountKey: string;
}

export class FieldRenameProgressModal extends Modal {
	private snapshot: FieldRenameProgressSnapshot;
	private copy: FieldRenameProgressModalCopy;
	private canClose = false;
	private statusEl: HTMLElement | null = null;
	private fileTaskValueEl: HTMLElement | null = null;
	private inlineTaskValueEl: HTMLElement | null = null;
	private fileValueEl: HTMLElement | null = null;
	private okButtonEl: HTMLButtonElement | null = null;
	private introEl: HTMLElement | null = null;

	constructor(app: App, initialSnapshot: FieldRenameProgressSnapshot, copy?: Partial<FieldRenameProgressModalCopy>) {
		super(app);
		this.snapshot = initialSnapshot;
		this.copy = {
			title: t('taskEditor', 'applyingRenameMigration'),
			intro: t('taskEditor', 'renameMigrationIntro'),
			stopped: t('taskEditor', 'renameMigrationStopped'),
			fileTasks: t('taskEditor', 'renameMigrationFileTasks'),
			inlineTasks: t('taskEditor', 'renameMigrationInlineTasks'),
			files: t('taskEditor', 'renameMigrationFiles'),
			reindexing: t('taskEditor', 'renameMigrationReindexing'),
			finished: t('taskEditor', 'renameMigrationFinished'),
			finishedIntro: t('taskEditor', 'renameMigrationFinishedIntro'),
			updating: t('taskEditor', 'renameMigrationUpdating'),
			failedCountCategory: 'taskEditor',
			failedCountKey: 'renameMigrationFailedCount',
			...copy,
		};
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(this.copy.title);

			this.introEl = contentEl.createEl('p', { cls: 'operon-field-rename-progress-intro' });
			this.introEl.setText(this.copy.intro);

			const rows = contentEl.createDiv('operon-field-rename-progress-rows');

		this.fileTaskValueEl = this.createProgressRow(rows, this.copy.fileTasks);
		this.inlineTaskValueEl = this.createProgressRow(rows, this.copy.inlineTasks);
		this.fileValueEl = this.createProgressRow(rows, this.copy.files);

			this.statusEl = contentEl.createDiv('operon-field-rename-progress-status');

			const actionsEl = contentEl.createDiv('operon-field-rename-progress-actions');

		this.okButtonEl = actionsEl.createEl('button', { text: t('buttons', 'ok') });
		this.okButtonEl.addClass('mod-cta');
		this.okButtonEl.disabled = true;
		this.okButtonEl.addEventListener('click', () => {
			if (!this.canClose) return;
			super.close();
		});

		this.renderSnapshot();
	}

	onClose(): void {
		this.contentEl.empty();
		this.introEl = null;
		this.statusEl = null;
		this.fileTaskValueEl = null;
		this.inlineTaskValueEl = null;
		this.fileValueEl = null;
		this.okButtonEl = null;
	}

	update(snapshot: FieldRenameProgressSnapshot): void {
		this.snapshot = snapshot;
		this.renderSnapshot();
	}

	markFatalError(message: string): void {
		this.canClose = true;
		if (this.statusEl) {
			this.statusEl.setText(message);
		}
		if (this.introEl) {
			this.introEl.setText(this.copy.stopped);
		}
		if (this.okButtonEl) {
			this.okButtonEl.disabled = false;
		}
	}

	close(): void {
		if (!this.canClose) return;
		super.close();
	}

	private createProgressRow(containerEl: HTMLElement, label: string): HTMLElement {
			const row = containerEl.createDiv('operon-field-rename-progress-row');

			row.createSpan({ cls: 'operon-field-rename-progress-label', text: label });

			const valueEl = row.createSpan('operon-field-rename-progress-value');
			return valueEl;
		}

	private renderSnapshot(): void {
		if (!this.fileTaskValueEl || !this.inlineTaskValueEl || !this.fileValueEl || !this.statusEl) return;

		this.fileTaskValueEl.setText(this.formatProgress(
			this.snapshot.processedFileTaskCount,
			this.snapshot.totalFileTaskCount,
			this.snapshot.failedFileTaskCount,
		));
		this.inlineTaskValueEl.setText(this.formatProgress(
			this.snapshot.processedInlineTaskCount,
			this.snapshot.totalInlineTaskCount,
			this.snapshot.failedInlineTaskCount,
		));
		this.fileValueEl.setText(`${this.snapshot.processedFileCount}/${this.snapshot.totalFileCount}`);

		if (this.snapshot.phase === 'reindexing') {
			this.statusEl.setText(this.copy.reindexing);
		} else if (this.snapshot.phase === 'complete') {
			this.canClose = true;
			this.statusEl.setText(this.copy.finished);
			if (this.introEl) {
				this.introEl.setText(this.copy.finishedIntro);
			}
			if (this.okButtonEl) {
				this.okButtonEl.disabled = false;
			}
		} else {
			this.statusEl.setText(this.copy.updating);
		}
	}

	private formatProgress(processed: number, total: number, failed: number): string {
		if (failed > 0) {
			return t(this.copy.failedCountCategory, this.copy.failedCountKey, {
				processed: String(processed),
				total: String(total),
				failed: String(failed),
			});
		}
		return `${processed}/${total}`;
	}
}
