import { OperonIndexer } from '../indexer/indexer';
import {
	DEFAULT_CHILD_TASK_INHERITANCE_FIELDS,
	isChildTaskInheritanceEligibleFieldKey,
	normalizeChildTaskInheritanceFields,
	OperonSettings,
} from '../types/settings';
import { composeStatusValue, parseStatusValue } from '../types/pipeline';
import { normalizeTaskIconValue } from './task-icon-value';
import { normalizeTaskColorValue } from './task-color-value';

export interface SubtaskInitialFields {
	parentTask?: string;
	status?: string;
	priority?: string;
	taskIcon?: string;
	taskColor?: string;
	[key: string]: string | undefined;
}

function resolveInitialStatus(parentStatus: string | undefined, settings: OperonSettings): string | undefined {
	const pipelines = settings.pipelines ?? [];
	const parsed = parentStatus ? parseStatusValue(parentStatus) : null;
	const defaultPipeline = pipelines.find(candidate => candidate.name === settings.defaultPipelineName) ?? pipelines[0];
	const targetPipeline = settings.childTaskInheritanceStatusPipelineSource === 'default'
		? defaultPipeline
		: parsed
			? pipelines.find(candidate => candidate.name === parsed.pipeline)
			: defaultPipeline;

	const firstStatus = targetPipeline?.statuses[0];
	if (!targetPipeline || !firstStatus) return undefined;
	return composeStatusValue(targetPipeline.name, firstStatus.label);
}

function resolveInheritanceFieldKeys(parentTaskId: string | null, settings: OperonSettings): string[] {
	if (!parentTaskId) return [...DEFAULT_CHILD_TASK_INHERITANCE_FIELDS];
	return normalizeChildTaskInheritanceFields(settings.childTaskInheritanceFields, settings.keyMappings);
}

function applyInheritedField(
	inherited: SubtaskInitialFields,
	key: string,
	parentFields: Record<string, string>,
	settings: OperonSettings,
): void {
	if (key === 'status') {
		const inheritedStatus = resolveInitialStatus(parentFields.status, settings);
		if (inheritedStatus) inherited.status = inheritedStatus;
		return;
	}
	if (key === 'priority') {
		if (parentFields.priority?.trim()) {
			inherited.priority = parentFields.priority.trim();
		} else if (settings.defaultPriority?.trim()) {
			inherited.priority = settings.defaultPriority.trim();
		}
		return;
	}
	if (key === 'taskIcon') {
		const normalizedTaskIcon = normalizeTaskIconValue(parentFields.taskIcon);
		if (normalizedTaskIcon) inherited.taskIcon = normalizedTaskIcon;
		return;
	}
	if (key === 'taskColor') {
		const normalizedTaskColor = normalizeTaskColorValue(parentFields.taskColor);
		if (normalizedTaskColor) inherited.taskColor = normalizedTaskColor;
		return;
	}
	const value = parentFields[key]?.trim();
	if (value && isChildTaskInheritanceEligibleFieldKey(key, settings.keyMappings)) {
		inherited[key] = value;
	}
}

export function resolveSubtaskInitialFieldsFromParentValues(
	parentTaskId: string | null,
	parentFieldValues: Record<string, string> | null | undefined,
	settings: OperonSettings,
): SubtaskInitialFields {
	const inherited: SubtaskInitialFields = {};
	const parentFields = parentFieldValues ?? {};
	if (parentTaskId) inherited.parentTask = parentTaskId;

	for (const key of resolveInheritanceFieldKeys(parentTaskId, settings)) {
		applyInheritedField(inherited, key, parentFields, settings);
	}

	return inherited;
}

export function getSubtaskInitialFieldKeys(inherited: SubtaskInitialFields): string[] {
	return Object.keys(inherited).filter(key => !!inherited[key]?.trim());
}

export function getSubtaskInheritedFieldKeys(inherited: SubtaskInitialFields): string[] {
	return getSubtaskInitialFieldKeys(inherited).filter(key => key !== 'parentTask');
}

export function resolveSubtaskInitialFields(
	parentTaskId: string | null,
	indexer: OperonIndexer,
	settings: OperonSettings,
): SubtaskInitialFields {
	const parent = parentTaskId ? indexer.getTask(parentTaskId) : null;
	return resolveSubtaskInitialFieldsFromParentValues(parentTaskId, parent?.fieldValues, settings);
}
