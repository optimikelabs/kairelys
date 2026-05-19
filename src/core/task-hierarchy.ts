import { IndexedTask } from '../types/fields';

const DEFAULT_MAX_PARENT_DEPTH = 20;

function buildTaskLookup(tasks: IndexedTask[]): Map<string, IndexedTask> {
	return new Map(tasks.map(task => [task.operonId, task]));
}

function appendUnique(values: string[], seen: Set<string>, value: string): void {
	const normalized = value.trim();
	if (!normalized || seen.has(normalized)) return;
	seen.add(normalized);
	values.push(normalized);
}

export function collectAncestorTaskIds(
	tasks: IndexedTask[],
	operonId: string,
	maxDepth = DEFAULT_MAX_PARENT_DEPTH,
): string[] {
	const taskById = buildTaskLookup(tasks);
	const ancestors: string[] = [];
	const seen = new Set<string>();
	let currentId = operonId.trim();
	if (!currentId) return ancestors;
	seen.add(currentId);

	let depth = 0;
	while (currentId && depth < maxDepth) {
		const task = taskById.get(currentId);
		const parentId = task?.fieldValues['parentTask']?.trim() ?? '';
		if (!parentId || seen.has(parentId)) break;
		seen.add(parentId);
		ancestors.push(parentId);
		currentId = parentId;
		depth += 1;
	}

	return ancestors;
}

export function buildSubtaskExcludedIds(options: {
	allTasks: IndexedTask[];
	currentTaskId?: string | null;
	parentTaskId?: string | null;
	maxDepth?: number;
}): string[] {
	const values: string[] = [];
	const seen = new Set<string>();
	const currentTaskId = options.currentTaskId?.trim() ?? '';
	const parentTaskId = options.parentTaskId?.trim() ?? '';
	const maxDepth = options.maxDepth ?? DEFAULT_MAX_PARENT_DEPTH;

	appendUnique(values, seen, currentTaskId);
	appendUnique(values, seen, parentTaskId);

	const ancestorSeed = parentTaskId || currentTaskId;
	for (const ancestorId of collectAncestorTaskIds(options.allTasks, ancestorSeed, maxDepth)) {
		appendUnique(values, seen, ancestorId);
	}

	return values;
}
