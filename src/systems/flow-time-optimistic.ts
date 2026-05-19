import { IndexedTask } from '../types/fields';
import { ActiveTrackerState, TimeTrackerTransitionState } from '../types/tracker';
import { OptimisticTaskPatchInput, applyOptimisticRenderPatch } from './optimistic-status-patch';
import { parseLocalDatetime } from './tracker-utils';

export interface FlowTimePendingDraft {
	description: string;
	start: string;
	startedAtMs: number;
}

export interface FlowTimeRenderedState {
	active: ActiveTrackerState | null;
	task: IndexedTask | null;
	pendingDraft: FlowTimePendingDraft | null;
	transitionKind: TimeTrackerTransitionState['kind'] | null;
	isOptimistic: boolean;
}

export interface FlowTimeRenderSignatureInput {
	indexGeneration: number;
	settingsValues: string[];
	activeKey: string;
	breakKey: string;
	pendingDraftKey: string;
	taskKey: string;
	hasRenderedTask: boolean;
}

export function buildFlowTimeRenderSignature(input: FlowTimeRenderSignatureInput): string {
	return [
		input.hasRenderedTask ? String(input.indexGeneration) : 'no-index-task',
		...input.settingsValues,
		input.activeKey,
		input.breakKey,
		input.pendingDraftKey,
		input.taskKey,
	].join('§');
}

export function resolveFlowTimeRenderedState(options: {
	active: ActiveTrackerState | null;
	transition: TimeTrackerTransitionState | null;
	pendingTask: IndexedTask | null;
	pendingDraft: FlowTimePendingDraft | null;
	optimisticPatch?: OptimisticTaskPatchInput | null;
	nowMs?: number;
	getTask: (taskId: string) => IndexedTask | null | undefined;
}): FlowTimeRenderedState {
	const { transition } = options;
	const nowMs = options.nowMs ?? Date.now();
	if (transition?.kind === 'stopping') {
		return {
			active: null,
			task: null,
			pendingDraft: null,
			transitionKind: 'stopping',
			isOptimistic: true,
		};
	}

	if (transition?.kind === 'starting') {
		const task = transition.taskId ? (options.getTask(transition.taskId) ?? null) : null;
		const active: ActiveTrackerState = {
			operonId: transition.taskId,
			start: transition.start,
			task: task ? applyMaybeOptimisticPatch(task, options.optimisticPatch) : null,
			elapsedSeconds: calculateTransitionElapsedSeconds(transition.start, nowMs),
			isUnassigned: !transition.taskId,
		};
		return {
			active,
			task: active.task ?? options.pendingTask,
			pendingDraft: active.task || options.pendingTask ? null : options.pendingDraft,
			transitionKind: 'starting',
			isOptimistic: true,
		};
	}

	const activeTask = options.active?.task
		? applyMaybeOptimisticPatch(options.active.task, options.optimisticPatch)
		: null;
	const active = options.active
		? {
			...options.active,
			task: activeTask,
		}
		: options.pendingDraft
			? buildPendingDraftActive(options.pendingDraft, nowMs)
			: null;
	const task = activeTask ?? options.pendingTask;
	return {
		active,
		task: activeTask ?? (options.pendingTask ? applyMaybeOptimisticPatch(options.pendingTask, options.optimisticPatch) : null),
		pendingDraft: task ? null : options.pendingDraft,
		transitionKind: options.pendingDraft && !options.active ? 'starting' : null,
		isOptimistic: !!options.optimisticPatch || (!!options.pendingDraft && !options.active),
	};
}

function buildPendingDraftActive(pendingDraft: FlowTimePendingDraft, nowMs: number): ActiveTrackerState {
	return {
		operonId: null,
		start: pendingDraft.start,
		task: null,
		elapsedSeconds: Math.max(0, Math.floor((nowMs - pendingDraft.startedAtMs) / 1000)),
		isUnassigned: true,
	};
}

function applyMaybeOptimisticPatch(
	task: IndexedTask,
	patch: OptimisticTaskPatchInput | null | undefined,
): IndexedTask {
	return patch ? applyOptimisticRenderPatch(task, patch) : task;
}

function calculateTransitionElapsedSeconds(start: string, nowMs: number): number {
	const parsed = parseLocalDatetime(start);
	if (!parsed) return 0;
	return Math.max(0, Math.floor((nowMs - parsed.getTime()) / 1000));
}
