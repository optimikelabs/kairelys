export function resolveTimedHorizontalVisibleStartIndex(
	bufferedDates: string[],
	visibleDates: string[],
	anchorDate: string,
	fallbackIndex: number,
): number {
	const safeFallback = Math.max(0, Math.min(Math.max(0, bufferedDates.length - 1), Math.round(fallbackIndex || 0)));
	const visibleStartDate = visibleDates[0] ?? anchorDate;
	const resolvedIndex = bufferedDates.indexOf(visibleStartDate);
	return resolvedIndex >= 0 ? resolvedIndex : safeFallback;
}

export function resolveTimedHorizontalOffsetBounds(
	bufferedDayCount: number,
	visibleDayCount: number,
	visibleStartBufferIndex: number,
	dayWidthPx: number,
): { minOffset: number; maxOffset: number } {
	const safeVisibleDayCount = Math.max(1, Math.round(visibleDayCount || 1));
	const safeBufferedDayCount = Math.max(safeVisibleDayCount, Math.round(bufferedDayCount || safeVisibleDayCount));
	const safeVisibleStartIndex = Math.max(0, Math.min(safeBufferedDayCount - safeVisibleDayCount, Math.round(visibleStartBufferIndex || 0)));
	const safeDayWidth = Math.max(0, dayWidthPx || 0);
	return {
		minOffset: -(safeVisibleStartIndex * safeDayWidth),
		maxOffset: Math.max(0, safeBufferedDayCount - safeVisibleStartIndex - safeVisibleDayCount) * safeDayWidth,
	};
}
