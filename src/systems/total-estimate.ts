/**
 * Total estimate propagation for parent tasks.
 * Computes totalEstimate as sum of own estimate + all descendants' estimates.
 *
 * totalEstimate = own estimate + sum of children's estimates (recursive)
 * Value in seconds (integer)
 */

import { OperonIndexer } from '../indexer/indexer';
import { TaskWriter } from '../core/task-writer';
import { localNow } from '../core/local-time';

export class TotalEstimateCalculator {
	private indexer: OperonIndexer;
	private writer: TaskWriter;

	constructor(indexer: OperonIndexer, writer: TaskWriter) {
		this.indexer = indexer;
		this.writer = writer;
	}

	/**
	 * Recalculate totalEstimate for a parent task.
	 * totalEstimate = own estimate + sum of all descendants' estimates.
	 */
	async recalculate(parentOperonId: string): Promise<void> {
		const parentTask = this.indexer.getTask(parentOperonId);
		if (!parentTask) return;

		const childIds = this.indexer.secondary.getChildIds(parentOperonId);
		if (childIds.size === 0) {
			if (!parentTask.fieldValues['totalEstimate']) return;
			delete parentTask.fieldValues['totalEstimate'];
			await this.writer.writeTaskFields(parentOperonId, {
				totalEstimate: '',
				datetimeModified: localNow(),
			}, { reindex: 'none' });
			await this.indexer.reindexFilePath(parentTask.primary.filePath, { notify: false });
			const grandparentId = parentTask.fieldValues['parentTask'];
			if (grandparentId) {
				await this.recalculate(grandparentId);
			}
			return;
		}

		const ownEstimate = parseInt(parentTask.fieldValues['estimate'] ?? '0', 10) || 0;

		let descendantEstimate = 0;
		const allDescendants = this.indexer.secondary.getAllDescendantIds(parentOperonId);

		for (const childId of allDescendants) {
			const child = this.indexer.getTask(childId);
			if (!child) continue;
			descendantEstimate += parseInt(child.fieldValues['estimate'] ?? '0', 10) || 0;
		}

		const totalEstimate = ownEstimate + descendantEstimate;
		const totalStr = totalEstimate > 0 ? String(totalEstimate) : '';
		const current = parentTask.fieldValues['totalEstimate'] ?? '';

		if (current === totalStr) return;

		if (totalStr) {
			parentTask.fieldValues['totalEstimate'] = totalStr;
		} else {
			delete parentTask.fieldValues['totalEstimate'];
		}

		const now = localNow();
		await this.writer.writeTaskFields(parentOperonId, {
			totalEstimate: totalStr,
			datetimeModified: now,
		}, { reindex: 'none' });
		await this.indexer.reindexFilePath(parentTask.primary.filePath, { notify: false });

		const grandparentId = parentTask.fieldValues['parentTask'];
		if (grandparentId) {
			await this.recalculate(grandparentId);
		}
	}

	/**
	 * Recalculate totalEstimate for a task's parent when child estimate changes.
	 */
	async recalculateForChild(childOperonId: string): Promise<void> {
		const child = this.indexer.getTask(childOperonId);
		if (!child) return;

		const parentId = child.fieldValues['parentTask'];
		if (!parentId) return;

		await this.recalculate(parentId);
	}
}
