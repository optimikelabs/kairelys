/**
 * Progress calculator for parent tasks.
 * Rolls up completion percentage from descendant terminal states.
 *
 * progress = (finishedDescendants / effectiveTotal) * 100
 * effectiveTotal = totalDescendants - cancelledDescendants
 * If effectiveTotal <= 0, progress = 0
 */

import { OperonIndexer } from '../indexer/indexer';
import { TaskWriter } from '../core/task-writer';
import { localNow } from '../core/local-time';
import { TASK_STATS_CANONICAL_KEYS, TaskStatsCanonicalKey } from '../types/keys';

export class ProgressCalculator {
	private indexer: OperonIndexer;
	private writer: TaskWriter;

	constructor(indexer: OperonIndexer, writer: TaskWriter) {
		this.indexer = indexer;
		this.writer = writer;
	}

	/**
	 * Recalculate progress for a parent task based on descendant states.
	 * Propagates up the hierarchy if this task also has a parent.
	 */
	async recalculate(parentOperonId: string): Promise<void> {
		const parentTask = this.indexer.getTask(parentOperonId);
		if (!parentTask) return;

		const childIds = this.indexer.secondary.getChildIds(parentOperonId);
		if (childIds.size === 0) return; // Not a parent task

		let directSubtaskCount = 0;
		let directDoneSubtaskCount = 0;
		let directOpenSubtaskCount = 0;
		let totalDescendants = 0;
		let finishedDescendants = 0;
		let cancelledDescendants = 0;
		let openDescendants = 0;

		for (const childId of childIds) {
			const child = this.indexer.getTask(childId);
			if (!child) continue;
			directSubtaskCount++;
			if (child.checkbox === 'done') {
				directDoneSubtaskCount++;
			} else if (child.checkbox === 'open') {
				directOpenSubtaskCount++;
			}
		}

		// Count all descendants recursively
		const allDescendants = this.indexer.secondary.getAllDescendantIds(parentOperonId);

		for (const childId of allDescendants) {
			const child = this.indexer.getTask(childId);
			if (!child) continue;

			totalDescendants++;

			if (child.checkbox === 'done') {
				finishedDescendants++;
			} else if (child.checkbox === 'cancelled') {
				cancelledDescendants++;
			} else if (child.checkbox === 'open') {
				openDescendants++;
			}
		}

		// Calculate progress
		const effectiveTotal = totalDescendants - cancelledDescendants;
		const progress = effectiveTotal > 0
			? Math.round((finishedDescendants / effectiveTotal) * 100)
			: 0;

		const taskStats: Record<TaskStatsCanonicalKey, string> = {
			directSubtaskCount: String(directSubtaskCount),
			directDoneSubtaskCount: String(directDoneSubtaskCount),
			directOpenSubtaskCount: String(directOpenSubtaskCount),
			treeDescendantCount: String(totalDescendants),
			treeDoneDescendantCount: String(finishedDescendants),
			treeOpenDescendantCount: String(openDescendants),
		};
		const payload: Record<string, string> = {};
		const currentProgress = parentTask.fieldValues['progress'];
		const newProgressStr = String(progress);
		if (currentProgress !== newProgressStr) {
			payload.progress = newProgressStr;
		}
		for (const key of TASK_STATS_CANONICAL_KEYS) {
			if ((parentTask.fieldValues[key] ?? '') !== taskStats[key]) {
				payload[key] = taskStats[key];
			}
		}

		// Only update if changed
		if (Object.keys(payload).length === 0) return;

		for (const [key, value] of Object.entries(payload)) {
			parentTask.fieldValues[key] = value;
		}

		// Write directly to parent task's file
		const now = localNow();
		await this.writer.writeTaskFields(parentOperonId, {
			...payload,
			datetimeModified: now,
		}, { reindex: 'none' });
		await this.indexer.reindexFilePath(parentTask.primary.filePath, { notify: false });

		// Propagate up the hierarchy
		const grandparentId = parentTask.fieldValues['parentTask'];
		if (grandparentId) {
			await this.recalculate(grandparentId);
		}
	}

	/**
	 * Recalculate progress for a task's parent when a child state changes.
	 */
	async recalculateForChild(childOperonId: string): Promise<void> {
		const child = this.indexer.getTask(childOperonId);
		if (!child) return;

		const parentId = child.fieldValues['parentTask'];
		if (!parentId) return;

		await this.recalculate(parentId);
	}
}
