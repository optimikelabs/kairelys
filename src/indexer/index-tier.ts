import type { CheckboxState } from '../types/keys';

export const INDEX_WARM_THRESHOLD_DAYS = 90;

/** Derive the non-authoritative RAM tier from current task state and time. */
export function computeIndexTier(
	checkbox: CheckboxState,
	fieldValues: Record<string, string>,
	nowMs: number = Date.now(),
): 'hot' | 'warm' | 'cold' {
	if (checkbox === 'open') return 'hot';
	const completedDate = fieldValues['dateCompleted'] || fieldValues['dateCancelled'];
	if (!completedDate) return 'warm';
	const completedMs = new Date(completedDate).getTime();
	const daysSince = (nowMs - completedMs) / (1000 * 60 * 60 * 24);
	return daysSince <= INDEX_WARM_THRESHOLD_DAYS ? 'warm' : 'cold';
}
