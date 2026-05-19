import { IndexedTask } from '../types/fields';

export interface FieldRenameAffectedTask {
	operonId: string;
	filePath: string;
	format: 'inline' | 'yaml';
	oldValue: string;
	newValue: string;
}

export interface FieldRenamePreview<TPlan = unknown> {
	plan: TPlan;
	affectedTasks: FieldRenameAffectedTask[];
	fileTaskCount: number;
	inlineTaskCount: number;
	touchedFileCount: number;
	totalTaskCount: number;
}

export interface FieldRenameExecutionResult {
	updatedFileTaskCount: number;
	updatedInlineTaskCount: number;
	failedFileTaskCount: number;
	failedInlineTaskCount: number;
	failedTaskIds: string[];
	failedFiles: string[];
	touchedFileCount: number;
}

export interface FieldRenameProgressSnapshot {
	totalFileTaskCount: number;
	totalInlineTaskCount: number;
	totalFileCount: number;
	processedFileTaskCount: number;
	processedInlineTaskCount: number;
	processedFileCount: number;
	failedFileTaskCount: number;
	failedInlineTaskCount: number;
	phase: 'writing' | 'reindexing' | 'complete';
}

export interface FieldRenameExecutionDeps {
	fieldName: string;
	logLabel: string;
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
	onProgress?: (snapshot: FieldRenameProgressSnapshot) => void;
}

export interface FieldRenameTaskSource {
	getTask(operonId: string): IndexedTask | undefined;
}

export function buildFieldRenamePreview<TPlan>(
	plan: TPlan,
	affectedTasksById: Map<string, FieldRenameAffectedTask>,
): FieldRenamePreview<TPlan> {
	const affectedTasks = Array.from(affectedTasksById.values()).sort((a, b) =>
		a.filePath.localeCompare(b.filePath)
		|| a.format.localeCompare(b.format)
		|| a.operonId.localeCompare(b.operonId),
	);
	const touchedFiles = new Set(affectedTasks.map(task => task.filePath));
	let fileTaskCount = 0;
	let inlineTaskCount = 0;
	for (const task of affectedTasks) {
		if (task.format === 'yaml') fileTaskCount += 1;
		else inlineTaskCount += 1;
	}

	return {
		plan,
		affectedTasks,
		fileTaskCount,
		inlineTaskCount,
		touchedFileCount: touchedFiles.size,
		totalTaskCount: affectedTasks.length,
	};
}

export async function executeFieldRenamePreview<TPlan>(
	preview: FieldRenamePreview<TPlan>,
	deps: FieldRenameExecutionDeps,
): Promise<FieldRenameExecutionResult> {
	const result: FieldRenameExecutionResult = {
		updatedFileTaskCount: 0,
		updatedInlineTaskCount: 0,
		failedFileTaskCount: 0,
		failedInlineTaskCount: 0,
		failedTaskIds: [],
		failedFiles: [],
		touchedFileCount: 0,
	};
	const touchedFiles = new Set<string>();
	const failedFiles = new Set<string>();
	const progress: FieldRenameProgressSnapshot = {
		totalFileTaskCount: preview.fileTaskCount,
		totalInlineTaskCount: preview.inlineTaskCount,
		totalFileCount: preview.touchedFileCount,
		processedFileTaskCount: 0,
		processedInlineTaskCount: 0,
		processedFileCount: 0,
		failedFileTaskCount: 0,
		failedInlineTaskCount: 0,
		phase: 'writing',
	};
	deps.onProgress?.({ ...progress });

		for (const task of preview.affectedTasks) {
			try {
				const fileWasTouched = touchedFiles.has(task.filePath);
				const writeResult = await deps.writer.writeTaskFields(task.operonId, { [deps.fieldName]: task.newValue }, { reindex: 'none' });
				if (writeResult === false) {
					throw new Error(`${deps.logLabel} rename migration skipped task write`);
				}
				if (!fileWasTouched) {
					touchedFiles.add(task.filePath);
					progress.processedFileCount += 1;
			}
			if (task.format === 'yaml') {
				result.updatedFileTaskCount += 1;
				progress.processedFileTaskCount += 1;
			} else {
				result.updatedInlineTaskCount += 1;
				progress.processedInlineTaskCount += 1;
			}
		} catch (error) {
			console.error(`Operon: ${deps.logLabel} rename migration failed for task`, task.operonId, error);
			result.failedTaskIds.push(task.operonId);
			failedFiles.add(task.filePath);
			if (task.format === 'yaml') {
				result.failedFileTaskCount += 1;
				progress.processedFileTaskCount += 1;
				progress.failedFileTaskCount += 1;
			} else {
				result.failedInlineTaskCount += 1;
				progress.processedInlineTaskCount += 1;
				progress.failedInlineTaskCount += 1;
			}
		}
		deps.onProgress?.({ ...progress });
	}

	if (touchedFiles.size > 0) {
		progress.phase = 'reindexing';
		deps.onProgress?.({ ...progress });
		await deps.indexer.reindexFilesBatch([...touchedFiles]);
	}

	result.touchedFileCount = touchedFiles.size;
	result.failedFiles = [...failedFiles].sort((a, b) => a.localeCompare(b));
	progress.phase = 'complete';
	progress.processedFileCount = touchedFiles.size;
	deps.onProgress?.({ ...progress });
	return result;
}
