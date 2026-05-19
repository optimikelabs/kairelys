export function parsePresetNumber(
	value: string,
	fallback: number,
	min: number,
	max: number,
	step = 1,
): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) return fallback;
	const clamped = Math.max(min, Math.min(max, parsed));
	if (step <= 1) return clamped;
	return Math.max(min, Math.min(max, Math.round(clamped / step) * step));
}
