import type { IndexedTask } from '../types/fields';

export type MarkdownRefreshScopeMode = 'global' | 'scoped';

export interface MarkdownRefreshScope {
	mode: MarkdownRefreshScopeMode;
	filePaths: string[];
	reason: string;
	fallbackReason?: string;
}

export interface ResolveStatusMarkdownRefreshScopeOptions {
	beforeTask: IndexedTask | null;
	afterTask: IndexedTask | null;
	getTask: (operonId: string) => IndexedTask | undefined;
	maxDepth?: number;
}

const DEFAULT_MAX_ANCESTOR_DEPTH = 100;

export function createGlobalMarkdownRefreshScope(
	reason: string,
	fallbackReason = 'global',
): MarkdownRefreshScope {
	return {
		mode: 'global',
		filePaths: [],
		reason,
		fallbackReason,
	};
}

export function createScopedMarkdownRefreshScope(
	filePaths: Iterable<string>,
	reason: string,
): MarkdownRefreshScope {
	const normalizedPaths = normalizeFilePaths(filePaths);
	if (normalizedPaths.length === 0) {
		return createGlobalMarkdownRefreshScope(reason, 'empty-scope');
	}
	return {
		mode: 'scoped',
		filePaths: normalizedPaths,
		reason,
	};
}

export function mergeMarkdownRefreshScopes(
	current: MarkdownRefreshScope | null,
	next: MarkdownRefreshScope | null | undefined,
): MarkdownRefreshScope {
	const normalizedNext = next ?? createGlobalMarkdownRefreshScope('refresh', 'unscoped-request');
	if (!current) return normalizeMarkdownRefreshScope(normalizedNext);
	if (current.mode === 'global') return normalizeMarkdownRefreshScope(current);
	if (normalizedNext.mode === 'global') return normalizeMarkdownRefreshScope(normalizedNext);
	return createScopedMarkdownRefreshScope(
		[...current.filePaths, ...normalizedNext.filePaths],
		current.reason === normalizedNext.reason ? current.reason : 'merged-scoped',
	);
}

export function resolveStatusMarkdownRefreshScope(
	options: ResolveStatusMarkdownRefreshScopeOptions,
): MarkdownRefreshScope {
	const reason = 'status-cycle';
	const maxDepth = options.maxDepth ?? DEFAULT_MAX_ANCESTOR_DEPTH;
	const roots = [options.beforeTask, options.afterTask].filter((task): task is IndexedTask => task !== null);
	if (roots.length === 0) return createGlobalMarkdownRefreshScope(reason, 'missing-task');

	const filePaths = new Set<string>();
	const rootIds = new Set<string>();
	for (const task of roots) {
		rootIds.add(task.operonId);
		if (task.primary.format !== 'inline') {
			return createGlobalMarkdownRefreshScope(reason, 'non-inline-task');
		}
		const filePath = task.primary.filePath.trim();
		if (!filePath) return createGlobalMarkdownRefreshScope(reason, 'missing-source-file');
		filePaths.add(filePath);
	}

	const collectResult = collectInlineAncestorFiles(options.beforeTask, options.getTask, filePaths, rootIds, maxDepth)
		?? collectInlineAncestorFiles(options.afterTask, options.getTask, filePaths, rootIds, maxDepth);
	if (collectResult) return collectResult;

	return createScopedMarkdownRefreshScope(filePaths, 'status-cycle-inline-chain');
}

function collectInlineAncestorFiles(
	task: IndexedTask | null,
	getTask: (operonId: string) => IndexedTask | undefined,
	filePaths: Set<string>,
	rootIds: Set<string>,
	maxDepth: number,
): MarkdownRefreshScope | null {
	if (!task) return null;
	let currentId = (task.fieldValues['parentTask'] ?? '').trim();
	const visited = new Set<string>(rootIds);
	let depth = 0;

	while (currentId) {
		if (visited.has(currentId)) {
			return createGlobalMarkdownRefreshScope('status-cycle', 'ancestor-cycle');
		}
		if (depth >= maxDepth) {
			return createGlobalMarkdownRefreshScope('status-cycle', 'ancestor-depth-limit');
		}
		const currentTask = getTask(currentId);
		if (!currentTask) {
			return createGlobalMarkdownRefreshScope('status-cycle', 'missing-parent');
		}
		if (currentTask.primary.format !== 'inline') {
			return createGlobalMarkdownRefreshScope('status-cycle', 'non-inline-ancestor');
		}
		const filePath = currentTask.primary.filePath.trim();
		if (!filePath) return createGlobalMarkdownRefreshScope('status-cycle', 'missing-ancestor-source-file');
		filePaths.add(filePath);
		visited.add(currentId);
		currentId = (currentTask.fieldValues['parentTask'] ?? '').trim();
		depth++;
	}

	return null;
}

function normalizeMarkdownRefreshScope(scope: MarkdownRefreshScope): MarkdownRefreshScope {
	if (scope.mode === 'global') {
		return {
			...scope,
			filePaths: [],
		};
	}
	return createScopedMarkdownRefreshScope(scope.filePaths, scope.reason);
}

function normalizeFilePaths(filePaths: Iterable<string>): string[] {
	return Array.from(new Set(Array.from(filePaths)
		.map(filePath => filePath.trim())
		.filter(Boolean)))
		.sort((left, right) => left.localeCompare(right));
}
