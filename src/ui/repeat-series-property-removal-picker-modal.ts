import { App, FuzzyMatch, FuzzySuggestModal } from 'obsidian';
import { t } from '../core/i18n';

export interface RepeatSeriesPropertyRemovalPickerOption {
	seriesId: string;
	title: string;
	path: string;
}

export class RepeatSeriesPropertyRemovalPickerModal extends FuzzySuggestModal<RepeatSeriesPropertyRemovalPickerOption> {
	private readonly options: RepeatSeriesPropertyRemovalPickerOption[];
	private readonly onChooseResult: (value: RepeatSeriesPropertyRemovalPickerOption) => void;
	private readonly onCancel: () => void;
	private resolved = false;

	constructor(
		app: App,
		options: RepeatSeriesPropertyRemovalPickerOption[],
		onChooseResult: (value: RepeatSeriesPropertyRemovalPickerOption) => void,
		onCancel: () => void = () => {},
	) {
		super(app);
		this.options = options;
		this.onChooseResult = onChooseResult;
		this.onCancel = onCancel;
		this.setPlaceholder(t('taskEditor', 'chooseRepeatingFileTaskSeries'));
		this.emptyStateText = t('taskEditor', 'noMatchingRepeatingFileTaskSeries');
		this.setInstructions([
			{ command: '↑↓', purpose: t('taskEditor', 'instructionNavigate') },
			{ command: 'Enter', purpose: t('taskEditor', 'instructionChooseSeries') },
			{ command: 'Esc', purpose: t('taskEditor', 'instructionCancel') },
		]);
	}

	getItems(): RepeatSeriesPropertyRemovalPickerOption[] {
		return this.options;
	}

	getItemText(item: RepeatSeriesPropertyRemovalPickerOption): string {
		return `${item.title} ${item.path}`;
	}

	renderSuggestion(match: FuzzyMatch<RepeatSeriesPropertyRemovalPickerOption>, el: HTMLElement): void {
		const option = match.item;
		el.empty();

		const primary = el.createDiv('operon-repeat-series-picker-primary');
		primary.setText(option.title);

			const secondary = el.createDiv('operon-repeat-series-picker-secondary');
			secondary.setText(option.path);
		}

	onChooseItem(item: RepeatSeriesPropertyRemovalPickerOption): void {
		this.resolved = true;
		this.close();
		window.setTimeout(() => this.onChooseResult(item), 0);
	}

	onClose(): void {
		super.onClose();
		if (!this.resolved) {
			window.setTimeout(() => this.onCancel(), 0);
		}
	}
}
