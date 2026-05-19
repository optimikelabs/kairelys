import { App, Modal } from 'obsidian';
import { t } from '../core/i18n';

export interface FileTaskNameModalOptions {
	title?: string;
	placeholder?: string;
	submitText?: string;
	initialValue?: string;
}

export class FileTaskNameModal extends Modal {
	private readonly options: FileTaskNameModalOptions;
	private readonly onCloseResult: (value: string | null) => void;
	private submitted = false;

	constructor(app: App, options: FileTaskNameModalOptions, onCloseResult: (value: string | null) => void) {
		super(app);
		this.options = options;
		this.onCloseResult = onCloseResult;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(this.options.title ?? t('taskEditor', 'fileTaskNameTitle'));

			const input = contentEl.createEl('input', {
				cls: 'operon-file-task-name-input',
				attr: {
					type: 'text',
				placeholder: this.options.placeholder ?? t('taskEditor', 'creatorDescriptionPlaceholder'),
				spellcheck: 'false',
				},
				value: this.options.initialValue ?? '',
			});

			const actions = contentEl.createDiv('operon-file-task-name-buttons');

		const cancelButton = actions.createEl('button', { text: t('buttons', 'cancel') });
		cancelButton.addEventListener('click', () => {
			this.finish(null);
		});

		const submitButton = actions.createEl('button', { text: this.options.submitText ?? t('buttons', 'continue') });
		submitButton.addClass('mod-cta');
		submitButton.addEventListener('click', () => {
			this.finish(input.value);
		});

		input.addEventListener('keydown', (event: KeyboardEvent) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				this.finish(input.value);
			}
		});

		window.setTimeout(() => {
			input.focus();
			input.select();
		}, 0);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.submitted) {
			this.onCloseResult(null);
		}
	}

	private finish(value: string | null): void {
		this.submitted = true;
		this.close();
		this.onCloseResult(value === null ? null : value.trim());
	}
}
