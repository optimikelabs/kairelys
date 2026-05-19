export function runSettingsAsync(context: string, action: () => Promise<void>): void {
	void action().catch((error: unknown) => {
		console.error(`Operon: ${context}`, error);
	});
}

export function settingsAsyncHandler<TArgs extends unknown[]>(
	context: string,
	action: (...args: TArgs) => Promise<void>,
): (...args: TArgs) => void {
	return (...args: TArgs): void => {
		runSettingsAsync(context, () => action(...args));
	};
}
