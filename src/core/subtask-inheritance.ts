import { OperonIndexer } from '../indexer/indexer';
import { OperonSettings } from '../types/settings';
import { composeStatusValue, parseStatusValue } from '../types/pipeline';
import { normalizeTaskIconValue } from './task-icon-value';
import { normalizeTaskColorValue } from './task-color-value';

export interface SubtaskInitialFields {
	parentTask?: string;
	status?: string;
	priority?: string;
	taskIcon?: string;
	taskColor?: string;
}

function resolveInitialStatus(parentStatus: string | undefined, settings: OperonSettings): string | undefined {
	const pipelines = settings.pipelines ?? [];
	const parsed = parentStatus ? parseStatusValue(parentStatus) : null;
	const targetPipeline = parsed
		? pipelines.find(candidate => candidate.name === parsed.pipeline)
		: pipelines.find(candidate => candidate.name === settings.defaultPipelineName) ?? pipelines[0];

	const firstStatus = targetPipeline?.statuses[0];
	if (!targetPipeline || !firstStatus) return undefined;
	return composeStatusValue(targetPipeline.name, firstStatus.label);
}

export function resolveSubtaskInitialFieldsFromParentValues(
	parentTaskId: string | null,
	parentFieldValues: Record<string, string> | null | undefined,
	settings: OperonSettings,
): SubtaskInitialFields {
	const inherited: SubtaskInitialFields = {};
	const parentFields = parentFieldValues ?? {};
	if (parentTaskId) inherited.parentTask = parentTaskId;

	const inheritedStatus = resolveInitialStatus(parentFields.status, settings);
	if (inheritedStatus) inherited.status = inheritedStatus;

	if (parentFields.priority?.trim()) {
		inherited.priority = parentFields.priority.trim();
	} else if (settings.defaultPriority?.trim()) {
		inherited.priority = settings.defaultPriority.trim();
	}
	const normalizedTaskIcon = normalizeTaskIconValue(parentFields.taskIcon);
	if (normalizedTaskIcon) inherited.taskIcon = normalizedTaskIcon;
	const normalizedTaskColor = normalizeTaskColorValue(parentFields.taskColor);
	if (normalizedTaskColor) inherited.taskColor = normalizedTaskColor;

	return inherited;
}

export function resolveSubtaskInitialFields(
	parentTaskId: string | null,
	indexer: OperonIndexer,
	settings: OperonSettings,
): SubtaskInitialFields {
	const parent = parentTaskId ? indexer.getTask(parentTaskId) : null;
	return resolveSubtaskInitialFieldsFromParentValues(parentTaskId, parent?.fieldValues, settings);
}
