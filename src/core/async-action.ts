export function runAsyncAction(context: string, action: () => Promise<void>): void {
	void action().catch((error: unknown) => {
		console.error(`Operon: ${context}`, error);
	});
}

export function asyncHandler<TArgs extends unknown[]>(
	context: string,
	action: (...args: TArgs) => Promise<void>,
): (...args: TArgs) => void {
	return (...args: TArgs): void => {
		runAsyncAction(context, () => action(...args));
	};
}
