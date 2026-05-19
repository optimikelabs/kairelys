/**
 * Write queue for safe sequential file operations.
 * Prevents concurrent writes to the same resource.
 * Pattern adapted from MetaCards plugin.
 */

export class WriteQueue {
	private queues: Map<string, Promise<void>> = new Map();

	/**
	 * Queue a write operation for a given key.
	 * Operations with the same key execute sequentially.
	 * Different keys can execute concurrently.
	 */
	async enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
		const existing = this.queues.get(key) ?? Promise.resolve();

		let result: T;
		const next = existing.then(async () => {
			result = await operation();
		});
		const tracked = next.catch(() => {});

		this.queues.set(key, tracked);
		void tracked.finally(() => {
			if (this.queues.get(key) === tracked) {
				this.queues.delete(key);
			}
		});

		await next;
		return result!;
	}

	/**
	 * Check if a key has pending operations.
	 */
	hasPending(key: string): boolean {
		return this.queues.has(key);
	}

	/**
	 * Wait for all currently pending queues to settle.
	 */
	async drain(): Promise<void> {
		while (this.queues.size > 0) {
			await Promise.all(Array.from(this.queues.values()));
		}
	}

	/**
	 * Clear all queues. Use during cleanup/unload.
	 */
	clear(): void {
		this.queues.clear();
	}
}
