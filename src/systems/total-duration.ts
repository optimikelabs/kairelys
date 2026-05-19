/**
 * Total duration propagation for parent tasks.
 * Computes totalDuration as sum of own duration + all descendants' durations.
 *
 * totalDuration = own duration + sum of children's durations (recursive)
 * Value in seconds (integer)
 */

import { OperonIndexer } from '../indexer/indexer';
import { TaskWriter } from '../core/task-writer';
import { localNow } from '../core/local-time';

export class TotalDurationCalculator {
	private indexer: OperonIndexer;
	private writer: TaskWriter;

	constructor(indexer: OperonIndexer, writer: TaskWriter) {
		this.indexer = indexer;
		this.writer = writer;
	}

	/**
	 * Recalculate totalDuration for a parent task.
	 * totalDuration = own duration + sum of all descendants' durations.
	 */
	async recalculate(parentOperonId: string): Promise<void> {
		const parentTask = this.indexer.getTask(parentOperonId);
		if (!parentTask) return;

		const childIds = this.indexer.secondary.getChildIds(parentOperonId);
		if (childIds.size === 0) {
			if (!parentTask.fieldValues['totalDuration']) return;
			delete parentTask.fieldValues['totalDuration'];
			await this.writer.writeTaskFields(parentOperonId, {
				totalDuration: '',
				datetimeModified: localNow(),
			}, { reindex: 'none' });
			await this.indexer.reindexFilePath(parentTask.primary.filePath, { notify: false });
			const grandparentId = parentTask.fieldValues['parentTask'];
			if (grandparentId) {
				await this.recalculate(grandparentId);
			}
			return;
		}

		// Own duration
		const ownDuration = parseInt(parentTask.fieldValues['duration'] ?? '0', 10) || 0;

		// Sum all descendants' durations
		let descendantDuration = 0;
		const allDescendants = this.indexer.secondary.getAllDescendantIds(parentOperonId);

		for (const childId of allDescendants) {
			const child = this.indexer.getTask(childId);
			if (!child) continue;
			descendantDuration += parseInt(child.fieldValues['duration'] ?? '0', 10) || 0;
		}

		const totalDuration = ownDuration + descendantDuration;
		const totalStr = totalDuration > 0 ? String(totalDuration) : '';
		const current = parentTask.fieldValues['totalDuration'] ?? '';

		// Only update if changed
		if (current === totalStr) return;

		if (totalStr) {
			parentTask.fieldValues['totalDuration'] = totalStr;
		} else {
			delete parentTask.fieldValues['totalDuration'];
		}

		// Write directly to parent task's file
		const now = localNow();
		await this.writer.writeTaskFields(parentOperonId, {
			totalDuration: totalStr,
			datetimeModified: now,
		}, { reindex: 'none' });
		await this.indexer.reindexFilePath(parentTask.primary.filePath, { notify: false });

		// Propagate up
		const grandparentId = parentTask.fieldValues['parentTask'];
		if (grandparentId) {
			await this.recalculate(grandparentId);
		}
	}

	/**
	 * Recalculate totalDuration for a task's parent when child duration changes.
	 */
	async recalculateForChild(childOperonId: string): Promise<void> {
		const child = this.indexer.getTask(childOperonId);
		if (!child) return;

		const parentId = child.fieldValues['parentTask'];
		if (!parentId) return;

		await this.recalculate(parentId);
	}
}
