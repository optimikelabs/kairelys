import { TASK_STATS_CANONICAL_KEYS, type TaskStatsCanonicalKey } from '../types/keys';

type TaskStatsFieldValues = Record<string, string | undefined>;

export interface TaskStatsCountGroup {
	total: number;
	done: number;
	open: number;
	cancelled: number;
	effective: number;
}

export interface TaskStatsReadModel {
	direct: TaskStatsCountGroup;
	tree: TaskStatsCountGroup;
}

export interface TaskStatsProgressCounts {
	completed: number;
	total: number;
	allCompleted: boolean;
}

export interface TaskStatsEditorProgress {
	hasSubtasks: boolean;
	done: number;
	total: number;
	progressPct: number;
}

export interface TaskStatsKanbanDescendantSummary {
	open: number;
	total: number;
}

export function parseTaskStatsReadModel(fieldValues: TaskStatsFieldValues): TaskStatsReadModel | null {
	const values: Partial<Record<TaskStatsCanonicalKey, number>> = {};
	for (const key of TASK_STATS_CANONICAL_KEYS) {
		const count = readRequiredCount(fieldValues, key);
		if (count === null) {
			return null;
		}
		values[key] = count;
	}

	const direct = buildCountGroup(
		values.directSubtaskCount!,
		values.directDoneSubtaskCount!,
		values.directOpenSubtaskCount!,
	);
	const tree = buildCountGroup(
		values.treeDescendantCount!,
		values.treeDoneDescendantCount!,
		values.treeOpenDescendantCount!,
	);
	if (!direct || !tree) {
		return null;
	}
	if (direct.total > tree.total || direct.done > tree.done || direct.open > tree.open) {
		return null;
	}
	return { direct, tree };
}

export function resolveTaskEditorProgressFromStats(fieldValues: TaskStatsFieldValues): TaskStatsEditorProgress | null {
	const stats = parseTaskStatsReadModel(fieldValues);
	if (!stats || stats.direct.total <= 0) {
		return null;
	}
	const total = stats.tree.total;
	const done = stats.tree.done;
	return {
		hasSubtasks: true,
		done,
		total,
		progressPct: total > 0 ? Math.round((done / total) * 100) : 0,
	};
}

export function resolveKanbanDescendantSummaryFromStats(
	fieldValues: TaskStatsFieldValues,
): TaskStatsKanbanDescendantSummary | null {
	const stats = parseTaskStatsReadModel(fieldValues);
	if (!stats) {
		return null;
	}
	return {
		open: stats.tree.open,
		total: stats.tree.total,
	};
}

export function resolveDirectSubtaskProgressFromStats(
	fieldValues: TaskStatsFieldValues,
	expectedDirectTotal: number,
): TaskStatsProgressCounts | null {
	const stats = parseTaskStatsReadModel(fieldValues);
	if (!stats || stats.direct.total !== expectedDirectTotal) {
		return null;
	}
	return {
		completed: stats.direct.done,
		total: stats.direct.total,
		allCompleted: stats.direct.total > 0 && stats.direct.done === stats.direct.total,
	};
}

function readRequiredCount(fieldValues: TaskStatsFieldValues, key: TaskStatsCanonicalKey): number | null {
	if (!Object.prototype.hasOwnProperty.call(fieldValues, key)) {
		return null;
	}
	const rawValue = fieldValues[key];
	if (rawValue === undefined) {
		return null;
	}
	const value = rawValue.trim();
	if (!value) {
		return null;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
		return null;
	}
	return parsed;
}

function buildCountGroup(total: number, done: number, open: number): TaskStatsCountGroup | null {
	const effective = done + open;
	if (effective > total) {
		return null;
	}
	return {
		total,
		done,
		open,
		cancelled: total - effective,
		effective,
	};
}
