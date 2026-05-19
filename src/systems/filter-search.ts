import {
	GroupedFilterGroup,
	GroupedFilterResults,
	GroupedFilterSubgroup,
} from '../core/filter-evaluator';
import { parseListValue } from '../core/parser';
import { resolveWorkflowStatus, Pipeline } from '../types/pipeline';
import { matchesTaskSearchQueryText } from './task-search';
import { IndexedTask } from '../types/fields';

export interface FilterTreeScopeOptions {
	getIndexedTask: (id: string) => IndexedTask | undefined;
	getChildIds: (parentId: string) => string[];
	pipelines: Pipeline[];
	showOnlyOpenSubtasks: boolean;
}

export function isFilterSearchActive(query: string): boolean {
	return query.trim().length >= 2;
}

export function buildFilterTreeScope(
	rootTasks: IndexedTask[],
	options: FilterTreeScopeOptions,
): IndexedTask[] {
	const tasks: IndexedTask[] = [];
	const seen = new Set<string>();
	const stack = [...rootTasks].reverse();

	while (stack.length > 0) {
		const task = stack.pop()!;
		if (seen.has(task.operonId)) continue;
		seen.add(task.operonId);
		tasks.push(task);

		const childIds = options.getChildIds(task.operonId);
		for (let index = childIds.length - 1; index >= 0; index--) {
			const childId = childIds[index];
			if (childId === task.operonId || seen.has(childId)) continue;
			const childTask = options.getIndexedTask(childId);
			if (!childTask) continue;
			if (options.showOnlyOpenSubtasks && !isOpenSubtask(childTask, options.pipelines)) continue;
			stack.push(childTask);
		}
	}

	return tasks;
}

export function applyFilterSearch(tasks: IndexedTask[], query: string): IndexedTask[] {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	if (!normalizedQuery) return tasks;
	return tasks.filter(task => matchesTaskSearchQueryText(buildDirectTaskSearchText(task), normalizedQuery));
}

export function applyGroupedFilterSearch(grouped: GroupedFilterResults, query: string): GroupedFilterResults {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	if (!normalizedQuery) return grouped;

	const groups: GroupedFilterGroup[] = [];
	for (const group of grouped.groups) {
		if (group.subgroups?.length) {
			const subgroups: GroupedFilterSubgroup[] = group.subgroups
				.map(subgroup => {
					const tasks = applyFilterSearch(subgroup.tasks, normalizedQuery);
					return {
						...subgroup,
						count: tasks.length,
						tasks,
					};
				})
				.filter(subgroup => subgroup.count > 0);

			if (subgroups.length === 0) continue;

			const tasks = applyFilterSearch(group.tasks, normalizedQuery);
			groups.push({
				...group,
				count: subgroups.reduce((sum, subgroup) => sum + subgroup.count, 0),
				tasks,
				subgroups,
			});
			continue;
		}

		const tasks = applyFilterSearch(group.tasks, normalizedQuery);
		if (tasks.length === 0) continue;
		groups.push({
			...group,
			count: tasks.length,
			tasks,
		});
	}

	return {
		totalCount: groups.reduce((sum, group) => sum + group.count, 0),
		groups,
	};
}

function buildDirectTaskSearchText(task: IndexedTask): string {
	const values = new Set<string>();
	const addValue = (value: string | null | undefined): void => {
		const normalized = (value ?? '').trim();
		if (normalized) values.add(normalized.toLocaleLowerCase());
	};
	const addValues = (entries: Iterable<string>): void => {
		for (const entry of entries) addValue(entry);
	};

	addValue(task.description);
	addValue(task.operonId);
	addValue(task.primary.filePath);
	addValue(task.fieldValues['note']);
	addValue(task.fieldValues['priority']);
	addValue(task.fieldValues['status']);
	for (const tag of task.tags) addValue(tag);
	addValues(parseListValue(task.fieldValues['contexts'] ?? ''));
	addValues(parseListValue(task.fieldValues['assignees'] ?? ''));
	for (const fieldKey of ['dateDue', 'dateScheduled', 'dateStarted', 'dateCompleted', 'dateCancelled'] as const) {
		addValue(task.fieldValues[fieldKey]);
	}

	return Array.from(values).join('\n');
}

function isOpenSubtask(task: IndexedTask, pipelines: Pipeline[]): boolean {
	if (task.checkbox === 'cancelled' || !!task.fieldValues['dateCancelled']?.trim()) return false;
	if (task.checkbox === 'done' || !!task.fieldValues['dateCompleted']?.trim()) return false;
	const workflow = resolveWorkflowStatus(pipelines, task.fieldValues['status']);
	return workflow?.definition.isCancelled !== true && workflow?.definition.isFinished !== true;
}
