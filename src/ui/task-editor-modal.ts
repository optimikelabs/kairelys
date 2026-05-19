/**
 * Task Editor Modal — thin wrapper around TaskEditorContent.
 * Opens the task editor as a floating modal window.
 */

import { App, Modal } from 'obsidian';
import { OperonIndexer } from '../indexer/indexer';
import { ParsedTask } from '../types/fields';
import { OperonSettings } from '../types/settings';
import { TaskEditorContent, OnSaveCallback, TaskEditorContentOptions } from './task-editor-content';
import { TimeTracker } from '../systems/time-tracker';

export class TaskEditorModal extends Modal {
	content: TaskEditorContent;
	onCloseSaveSettled: (() => void | Promise<void>) | null = null;

	constructor(
		app: App,
		indexer: OperonIndexer,
		settings: OperonSettings,
		existingTask: ParsedTask | null,
		onSave: OnSaveCallback,
		timeTracker: TimeTracker,
		options: TaskEditorContentOptions = {},
	) {
		super(app);
		this.content = new TaskEditorContent(app, indexer, settings, existingTask, onSave, timeTracker, options);
	}

	onOpen(): void {
		this.containerEl.addClass('operon-task-editor-modal-container');
		this.modalEl.addClass('operon-task-editor-modal');
		this.content.mountInto(this.contentEl);
		this.content.applyInitialDescriptionFocus();
		// Close modal when inner content requests it.
		this.contentEl.addEventListener('operon-editor-close', () => this.close(), { once: true });
	}

	onClose(): void {
		const closeSave = this.content.beginCloseSave();
		this.content.destroy({ skipCloseSave: true });
		void closeSave
			.catch(error => {
				console.error('Operon: task editor close-save failed', error);
			})
			.finally(() => {
				try {
					void Promise.resolve(this.onCloseSaveSettled?.()).catch(error => {
						console.warn('Operon: task editor close refresh failed', error);
					});
				} catch (error) {
					console.warn('Operon: task editor close refresh failed', error);
				}
			});
	}
}
