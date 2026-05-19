import { App } from 'obsidian';
import { t } from '../../core/i18n';
import { IndexedTask } from '../../types/fields';
import { showListPicker } from './list-picker';

interface RelatedPickerOptions {
	app: App;
	allTasks: IndexedTask[];
	value: string[];
	retainInputFocus?: boolean;
	onSave: (values: string[]) => void;
	onClose?: () => void;
}

export function showRelatedPicker(anchor: HTMLElement | DOMRect, options: RelatedPickerOptions): () => void {
	const candidates = collectRelatedCandidates(options.app, options.allTasks);
	return showListPicker(anchor, {
		title: t('taskEditor', 'related'),
		value: options.value,
		candidates,
		placeholder: t('taskEditor', 'relatedPlaceholder'),
		closeOnSelect: true,
		retainInputFocus: options.retainInputFocus,
		onSave: options.onSave,
		onClose: options.onClose,
	});
}

function collectRelatedCandidates(app: App, allTasks: IndexedTask[]): string[] {
	const values = new Set<string>();

	for (const task of allTasks) {
		const raw = task.fieldValues['related'];
		if (!raw) continue;
		for (const value of raw.split(';').map(item => item.trim()).filter(Boolean)) {
			values.add(value);
		}
	}

	for (const file of app.vault.getMarkdownFiles()) {
		values.add(`[[${file.basename}]]`);
	}

	return Array.from(values).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
