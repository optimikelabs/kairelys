export interface IndexV8MaintenanceSchedulerOptions<THandle> {
	run: () => Promise<boolean>;
	isActive: () => boolean;
	setTimeout: (callback: () => void, delayMs: number) => THandle;
	clearTimeout: (handle: THandle) => void;
	onError: (error: unknown) => void;
}

export interface IndexV8MaintenanceHandle {
	cancel(): void;
	drain(): Promise<void>;
}

/** Schedule one delayed cleanup pass with one bounded retry. */
export function startIndexV8CleanupMaintenance<THandle>(
	options: IndexV8MaintenanceSchedulerOptions<THandle>,
): IndexV8MaintenanceHandle {
	let cancelled = false;
	let handle: THandle | null = null;
	let activeRun: Promise<void> = Promise.resolve();
	const schedule = (delayMs: number, retriesRemaining: number): void => {
		handle = options.setTimeout(() => {
			handle = null;
			activeRun = options.run()
				.then(completed => {
					if (!completed && retriesRemaining > 0 && !cancelled && options.isActive()) {
						schedule(15_000, retriesRemaining - 1);
					}
				})
				.catch(options.onError);
		}, delayMs);
	};
	schedule(30_000, 1);
	return {
		cancel: () => {
			cancelled = true;
			if (handle !== null) options.clearTimeout(handle);
			handle = null;
		},
		drain: async () => { await activeRun; },
	};
}
