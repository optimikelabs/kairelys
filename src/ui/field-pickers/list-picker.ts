import { t } from '../../core/i18n';
import {
	bindPickerListItemActivation,
	createButton,
	createChip,
	createFloatingPanel,
	requestFloatingInputFocus,
	type FloatingPanelOptions,
} from './common';

export interface ListPickerOptions {
	title: string;
	value: string[];
	candidates: string[];
	placeholder: string;
	formatValue?: (value: string) => string;
	normalize?: (value: string) => string;
	closeOnSelect?: boolean;
	retainInputFocus?: boolean;
	onSave: (values: string[]) => void;
	onClose?: () => void;
}

export interface SearchableMultiOption {
	value: string;
	label: string;
	searchText?: string;
}

export interface SearchableMultiOptionPickerOptions {
	title: string;
	value: string[];
	options: SearchableMultiOption[];
	placeholder: string;
	allowCustom?: boolean;
	queryActionLabel?: (query: string) => string | null;
	onQueryAction?: (query: string) => void;
	closeOnSelect?: boolean;
	retainInputFocus?: boolean;
	floatingOptions?: FloatingPanelOptions;
	onSave: (values: string[]) => void;
	onClose?: () => void;
	onPanelClose?: () => void;
}

export function showListPicker(anchor: HTMLElement | DOMRect, options: ListPickerOptions): () => void {
	return showSearchableMultiOptionPicker(anchor, {
		title: options.title,
		value: options.value,
		options: options.candidates.map(candidate => ({
			value: normalizeValue(candidate, options.normalize),
			label: formatValue(candidate, options.formatValue),
			searchText: candidate,
		})),
		placeholder: options.placeholder,
		allowCustom: true,
		closeOnSelect: options.closeOnSelect,
		retainInputFocus: options.retainInputFocus,
		onSave: options.onSave,
		onClose: options.onClose,
	});
}

export function showSearchableMultiOptionPicker(
	anchor: HTMLElement | DOMRect,
	options: SearchableMultiOptionPickerOptions,
): () => void {
	let saved = false;
	const { panel, close } = createFloatingPanel(anchor, 'operon-floating-panel operon-list-picker-panel', () => {
		options.onPanelClose?.();
		if (!saved) options.onClose?.();
	}, {
		retainInputFocus: options.retainInputFocus,
		...options.floatingOptions,
	});
	panel.dataset.title = options.title;

	const title = panel.createDiv('operon-floating-title');
	title.textContent = options.title;

	const selectedWrap = panel.createDiv('operon-list-picker-selected');

	const input = panel.createEl('input');
	input.type = 'text';
	input.className = 'operon-floating-input';
	input.placeholder = options.placeholder;

	const list = panel.createDiv('operon-list-picker-suggestions');

	const optionsByValue = new Map(options.options.map(option => [option.value, option]));
	let selectedValues = Array.from(new Set(options.value.map(value => value.trim()).filter(Boolean)));
	let matches: SearchableMultiOption[] = [];
	let activeIndex = 0;

	const persist = () => {
		saved = true;
		options.onSave(selectedValues);
	};

	const removeValue = (value: string) => {
		selectedValues = selectedValues.filter(existing => existing !== value);
		renderSelected();
		renderSuggestions(input.value);
		persist();
	};

	const addValue = (rawValue: string) => {
		const normalized = rawValue.trim();
		if (!normalized || selectedValues.includes(normalized)) return;
		if (options.allowCustom !== true && !optionsByValue.has(normalized)) return;
		selectedValues.push(normalized);
		selectedValues = Array.from(new Set(selectedValues));
		renderSelected();
		renderSuggestions(input.value);
		persist();
		input.value = '';
		if (options.closeOnSelect) {
			close();
		}
	};

	const renderSelected = () => {
		selectedWrap.replaceChildren();
		for (const value of selectedValues) {
			const chip = selectedWrap.createSpan('operon-list-picker-chip');
			chip.appendChild(createChip(optionsByValue.get(value)?.label ?? value, 'operon-list-picker-chip-label', chip));

			const remove = createButton('×', 'operon-list-picker-chip-remove', chip);
			remove.addEventListener('click', () => removeValue(value));
			chip.appendChild(remove);
			selectedWrap.appendChild(chip);
		}
	};

	const renderSuggestions = (query: string) => {
		list.replaceChildren();
		const q = query.trim().toLocaleLowerCase();
		const available = options.options.filter(option => option.value && !selectedValues.includes(option.value));

		matches = q.length === 0
			? available
			: available.filter(option => `${option.label} ${option.searchText ?? ''}`.toLocaleLowerCase().includes(q));
		const visibleMatches = matches.slice(0, 12);
		const queryActionLabel = q ? options.queryActionLabel?.(query.trim()) ?? null : null;
		const selectableCount = visibleMatches.length + (queryActionLabel ? 1 : 0);
		activeIndex = selectableCount === 0 ? 0 : Math.min(activeIndex, selectableCount - 1);

		visibleMatches.forEach((match, index) => {
			const item = createButton(match.label, 'operon-list-picker-item', list);
			if (index === activeIndex) item.classList.add('is-active');
			item.addEventListener('mousemove', () => setActiveIndex(index));
			bindPickerListItemActivation(item, () => addValue(match.value));
			list.appendChild(item);
		});
		if (queryActionLabel) {
			const item = createButton(queryActionLabel, 'operon-list-picker-item is-query-action', list);
			if (visibleMatches.length === activeIndex) item.classList.add('is-active');
			item.addEventListener('mousemove', () => setActiveIndex(visibleMatches.length));
			bindPickerListItemActivation(item, () => {
				saved = true;
				options.onQueryAction?.(query.trim());
				close();
			});
			list.appendChild(item);
		}
	};

	const setActiveIndex = (nextIndex: number): void => {
		if (activeIndex === nextIndex) return;
		const previousItem = list.children[activeIndex] as HTMLElement | undefined;
		activeIndex = nextIndex;
		previousItem?.classList.remove('is-active');
		(list.children[activeIndex] as HTMLElement | undefined)?.classList.add('is-active');
	};

	input.addEventListener('input', () => renderSuggestions(input.value));
	input.addEventListener('keydown', (event) => {
		const queryActionLabel = input.value.trim()
			? options.queryActionLabel?.(input.value.trim()) ?? null
			: null;
		const visibleMatchCount = Math.min(matches.length, 12);
		const selectableCount = visibleMatchCount + (queryActionLabel ? 1 : 0);
		if (event.key === 'ArrowDown') {
			if (selectableCount === 0) return;
			event.preventDefault();
			activeIndex = Math.min(activeIndex + 1, selectableCount - 1);
			renderSuggestions(input.value);
			return;
		}
		if (event.key === 'ArrowUp') {
			if (selectableCount === 0) return;
			event.preventDefault();
			activeIndex = Math.max(activeIndex - 1, 0);
			renderSuggestions(input.value);
			return;
		}
		if (event.key === 'Enter' || event.key === ';' || event.key === 'Tab' || event.key === ',') {
			const typed = input.value.trim();
			if (event.key === 'Enter' && activeIndex < visibleMatchCount && matches[activeIndex]) {
				event.preventDefault();
				addValue(matches[activeIndex].value);
				return;
			}
			if (event.key === 'Enter' && queryActionLabel && activeIndex === visibleMatchCount) {
				event.preventDefault();
				saved = true;
				options.onQueryAction?.(typed);
				close();
				return;
			}
			if (typed && options.allowCustom === true) {
				event.preventDefault();
				addValue(typed);
			}
		}
	});

	const footer = panel.createDiv('operon-floating-actions');
	const doneButton = createButton(t('buttons', 'done'), 'operon-floating-btn', footer);
	doneButton.addEventListener('click', () => {
		persist();
		close();
	});
	footer.appendChild(doneButton);
	panel.appendChild(footer);

	renderSelected();
	renderSuggestions('');
	requestFloatingInputFocus(input);
	return close;
}

function normalizeValue(value: string, normalize?: (value: string) => string): string {
	const trimmed = value.trim();
	return normalize ? normalize(trimmed) : trimmed;
}

function formatValue(value: string, formatter?: (value: string) => string): string {
	return formatter ? formatter(value) : value;
}
