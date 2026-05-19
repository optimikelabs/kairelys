import { IndexedTask } from '../types/fields';
import { composeStatusValue, Pipeline } from '../types/pipeline';
import {
	FieldRenameAffectedTask,
	FieldRenameExecutionResult,
	FieldRenameProgressSnapshot,
	FieldRenamePreview,
	buildFieldRenamePreview,
	executeFieldRenamePreview,
} from './field-rename-migration';

export interface PipelineRenameOperation {
	statusId: string;
	oldValue: string;
	newValue: string;
	oldPipelineName: string;
	newPipelineName: string;
	oldStatusLabel: string;
	newStatusLabel: string;
}

export interface PipelineRenamePlan {
	pipelineId: string;
	oldPipeline: Pipeline;
	newPipeline: Pipeline;
	operations: PipelineRenameOperation[];
}

export interface PipelineRenameAffectedTask {
	operonId: string;
	filePath: string;
	format: 'inline' | 'yaml';
	oldStatusValue: string;
	newStatusValue: string;
}

export interface PipelineRenamePreview {
	plan: PipelineRenamePlan;
	affectedTasks: PipelineRenameAffectedTask[];
	fileTaskCount: number;
	inlineTaskCount: number;
	touchedFileCount: number;
	totalTaskCount: number;
}

export type PipelineRenameExecutionResult = FieldRenameExecutionResult;

export type PipelineRenameProgressSnapshot = FieldRenameProgressSnapshot;

export interface PipelineRenamePreviewSource {
	secondary: {
		getTaskIdsByWorkflowStatus(statusValue: string): Set<string>;
	};
	getTask(operonId: string): IndexedTask | undefined;
}

export interface PipelineRenameExecutionDeps {
		writer: {
			writeTaskFields(
				operonId: string,
				fieldValues: Record<string, string>,
				options?: { mode?: 'merge' | 'replace'; reindex?: 'scheduled' | 'none' },
			): Promise<boolean | void>;
		};
	indexer: {
		reindexFilesBatch(filePaths: string[]): Promise<void>;
	};
	onProgress?: (snapshot: PipelineRenameProgressSnapshot) => void;
}

export function buildPipelineRenamePlan(oldPipeline: Pipeline, newPipeline: Pipeline): PipelineRenamePlan {
	const oldStatusesById = new Map(oldPipeline.statuses.map(status => [status.id, status]));
	const pipelineRenamed = oldPipeline.name !== newPipeline.name;
	const operations: PipelineRenameOperation[] = [];

	for (const nextStatus of newPipeline.statuses) {
		const previousStatus = oldStatusesById.get(nextStatus.id);
		if (!previousStatus) continue;

		const statusRenamed = previousStatus.label !== nextStatus.label;
		if (!pipelineRenamed && !statusRenamed) continue;

		operations.push({
			statusId: nextStatus.id,
			oldValue: composeStatusValue(oldPipeline.name, previousStatus.label),
			newValue: composeStatusValue(newPipeline.name, nextStatus.label),
			oldPipelineName: oldPipeline.name,
			newPipelineName: newPipeline.name,
			oldStatusLabel: previousStatus.label,
			newStatusLabel: nextStatus.label,
		});
	}

	return {
		pipelineId: newPipeline.id,
		oldPipeline,
		newPipeline,
		operations,
	};
}

export function collectPipelineRenamePreview(
	source: PipelineRenamePreviewSource,
	plan: PipelineRenamePlan,
): PipelineRenamePreview {
	const affectedTasksById = new Map<string, FieldRenameAffectedTask>();

	for (const operation of plan.operations) {
		for (const operonId of source.secondary.getTaskIdsByWorkflowStatus(operation.oldValue)) {
			if (affectedTasksById.has(operonId)) continue;
			const task = source.getTask(operonId);
			if (!task) continue;

			affectedTasksById.set(operonId, {
				operonId,
				filePath: task.primary.filePath,
				format: task.primary.format,
				oldValue: operation.oldValue,
				newValue: operation.newValue,
			});
		}
	}

	return toPipelineRenamePreview(buildFieldRenamePreview(plan, affectedTasksById));
}

export async function executePipelineRenamePreview(
	preview: PipelineRenamePreview,
	deps: PipelineRenameExecutionDeps,
): Promise<PipelineRenameExecutionResult> {
	return executeFieldRenamePreview(fromPipelineRenamePreview(preview), {
		...deps,
		fieldName: 'status',
		logLabel: 'pipeline',
	});
}

function toPipelineRenamePreview(preview: FieldRenamePreview<PipelineRenamePlan>): PipelineRenamePreview {
	return {
		...preview,
		affectedTasks: preview.affectedTasks.map(task => ({
			operonId: task.operonId,
			filePath: task.filePath,
			format: task.format,
			oldStatusValue: task.oldValue,
			newStatusValue: task.newValue,
		})),
	};
}

function fromPipelineRenamePreview(preview: PipelineRenamePreview): FieldRenamePreview<PipelineRenamePlan> {
	return {
		...preview,
		affectedTasks: preview.affectedTasks.map(task => ({
			operonId: task.operonId,
			filePath: task.filePath,
			format: task.format,
			oldValue: task.oldStatusValue,
			newValue: task.newStatusValue,
		})),
	};
}
