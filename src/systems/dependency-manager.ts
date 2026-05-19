/**
 * Dependency manager for Operon tasks.
 * Maintains bidirectional blocking/blockedBy relationships.
 *
 * Write-through model: editing `blocking` on Task A writes `blockedBy` to Task B's file.
 * No sync engine — direct file writes via TaskWriter.
 */

import { OperonIndexer } from '../indexer/indexer';
import { TaskWriter } from '../core/task-writer';
import { localNow } from '../core/local-time';

/** Parse a semicolon-separated list of operonIds */
function parseIdList(value: string): string[] {
	if (!value) return [];
	return value.split(';').map(s => s.trim()).filter(Boolean);
}

/** Serialize an array of operonIds to semicolon-separated list */
function serializeIdList(ids: string[]): string {
	return ids.join('; ');
}

export class DependencyManager {
	private indexer: OperonIndexer;
	private writer: TaskWriter;

	constructor(indexer: OperonIndexer, writer: TaskWriter) {
		this.indexer = indexer;
		this.writer = writer;
	}

	/**
	 * Process a change to a task's blocking or blockedBy field.
	 * Propagates the inverse relationship to all referenced tasks.
	 */
	async processDependencyChange(
		operonId: string,
		field: 'blocking' | 'blockedBy',
		oldValue: string,
		newValue: string,
	): Promise<void> {
		const inverseField = field === 'blocking' ? 'blockedBy' : 'blocking';

		const oldIds = new Set(parseIdList(oldValue));
		const newIds = new Set(parseIdList(newValue));
		const writes: Array<Promise<void>> = [];

		// IDs added — add inverse on target
		for (const targetId of newIds) {
			if (!oldIds.has(targetId)) {
				writes.push(this.addInverse(targetId, inverseField, operonId));
			}
		}

		// IDs removed — remove inverse from target
		for (const targetId of oldIds) {
			if (!newIds.has(targetId)) {
				writes.push(this.removeInverse(targetId, inverseField, operonId));
			}
		}

		await Promise.all(writes);
	}

	/**
	 * Add operonId to target task's inverse field.
	 */
	private async addInverse(targetId: string, field: string, sourceId: string): Promise<void> {
		const task = this.indexer.getTask(targetId);
		if (!task) return;

		const currentList = parseIdList(task.fieldValues[field] ?? '');
		if (currentList.includes(sourceId)) return; // Already present

		currentList.push(sourceId);
		const newValue = serializeIdList(currentList);

		// Update index immediately
		task.fieldValues[field] = newValue;

		// Write directly to target task's file
		const now = localNow();
		task.fieldValues['datetimeModified'] = now;
		task.datetimeModified = now;
		await this.writer.writeTaskFields(targetId, {
			[field]: newValue,
			datetimeModified: now,
		});
	}

	/**
	 * Remove operonId from target task's inverse field.
	 */
	private async removeInverse(targetId: string, field: string, sourceId: string): Promise<void> {
		const task = this.indexer.getTask(targetId);
		if (!task) return;

		const currentList = parseIdList(task.fieldValues[field] ?? '');
		const filtered = currentList.filter(id => id !== sourceId);

		if (filtered.length === currentList.length) return; // Not present

		const newValue = serializeIdList(filtered);

		// Update index immediately
		if (newValue) {
			task.fieldValues[field] = newValue;
		} else {
			delete task.fieldValues[field];
		}

		// Write directly to target task's file
		const now = localNow();
		task.fieldValues['datetimeModified'] = now;
		task.datetimeModified = now;
		const updates: Record<string, string> = {
			[field]: newValue,
			datetimeModified: now,
		};
		await this.writer.writeTaskFields(targetId, updates);
	}

	/**
	 * Clean up all dependency references when a task is deleted.
	 */
	async cleanupDeletedTask(operonId: string): Promise<void> {
		const task = this.indexer.getTask(operonId);
		if (!task) return;
		const writes: Array<Promise<void>> = [];

		const blockingIds = parseIdList(task.fieldValues['blocking'] ?? '');
		for (const targetId of blockingIds) {
			writes.push(this.removeInverse(targetId, 'blockedBy', operonId));
		}

		const blockedByIds = parseIdList(task.fieldValues['blockedBy'] ?? '');
		for (const targetId of blockedByIds) {
			writes.push(this.removeInverse(targetId, 'blocking', operonId));
		}
		await Promise.all(writes);
	}
}
