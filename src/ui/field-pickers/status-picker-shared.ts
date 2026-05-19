import { Pipeline, parseStatusValue } from '../../types/pipeline';
import { scrollChildIntoView } from './common';

export interface StatusPickerOption {
	value: string;
	color: string;
}

export function buildStatusPickerOptions(pipelines: Pipeline[]): StatusPickerOption[] {
	const allStatuses: StatusPickerOption[] = [];
	for (const pipeline of pipelines) {
		for (const status of pipeline.statuses) {
			allStatuses.push({
				value: `${pipeline.name}.${status.label}`,
				color: status.color,
			});
		}
	}
	return allStatuses;
}

export function filterStatusPickerOptions(
	allStatuses: StatusPickerOption[],
	query: string,
): StatusPickerOption[] {
	const trimmed = query.trim();
	const parsed = trimmed ? parseStatusValue(trimmed) : null;
	const selectedPipeline = parsed
		&& allStatuses.some(status => status.value === trimmed)
		? parsed.pipeline
		: null;

	if (selectedPipeline) {
		return allStatuses.filter(status => parseStatusValue(status.value)?.pipeline === selectedPipeline);
	}

	return trimmed.length === 0
		? allStatuses
		: allStatuses.filter(status => status.value.toLowerCase().includes(trimmed.toLowerCase()));
}

export function ensureActiveStatusOptionVisible(container: HTMLElement, activeIndex: number): void {
	const activeItem = container.querySelector<HTMLElement>(`.operon-status-dropdown-item[data-status-index="${activeIndex}"]`);
	scrollChildIntoView(container, activeItem);
}
