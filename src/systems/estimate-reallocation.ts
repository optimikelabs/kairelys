import { IndexedTask } from '../types/fields';

export interface EstimateReallocationStep {
	operonId: string;
	label: string;
	estimateBeforeSeconds: number;
	subtractSeconds: number;
	estimateAfterSeconds: number;
}

export interface EstimateReallocationPreviewRow {
	operonId: string;
	label: string;
	currentEstimateSeconds: number;
	newEstimateSeconds: number;
	currentTotalEstimateSeconds: number | null;
	newTotalEstimateSeconds: number | null;
}

export interface ManualEstimateReallocationProposal {
	deltaSeconds: number;
	childEstimateBeforeSeconds: number;
	childEstimateAfterSeconds: number;
	totalAvailableSeconds: number;
	appliedSeconds: number;
	uncoveredSeconds: number;
	steps: EstimateReallocationStep[];
	previewRows: EstimateReallocationPreviewRow[];
	coverage: 'full' | 'partial';
}

export function buildManualEstimateReallocationProposal(
	params: {
		childOperonId?: string;
		childLabel?: string;
		persistedChildEstimateSeconds: number;
		draftChildEstimateSeconds: number;
		directParentOperonId: string;
		getTaskById: (operonId: string) => IndexedTask | null;
		getChildIds: (operonId: string) => Iterable<string>;
	},
): ManualEstimateReallocationProposal | null {
	const deltaSeconds = params.draftChildEstimateSeconds - params.persistedChildEstimateSeconds;
	if (deltaSeconds <= 0) return null;

	const directParentOperonId = params.directParentOperonId.trim();
	if (!directParentOperonId) return null;

	const steps: EstimateReallocationStep[] = [];
	const visited = new Set<string>();
	let remainingDelta = deltaSeconds;
	let currentOperonId = directParentOperonId;

	while (currentOperonId && remainingDelta > 0 && !visited.has(currentOperonId)) {
		visited.add(currentOperonId);
		const currentTask = params.getTaskById(currentOperonId);
		if (!currentTask) break;

		const estimateBeforeSeconds = parseEstimateSeconds(currentTask.fieldValues['estimate']);
		const subtractSeconds = Math.min(estimateBeforeSeconds, remainingDelta);
		steps.push({
			operonId: currentTask.operonId,
			label: currentTask.description.trim() || currentTask.operonId,
			estimateBeforeSeconds,
			subtractSeconds,
			estimateAfterSeconds: estimateBeforeSeconds - subtractSeconds,
		});
		if (subtractSeconds > 0) {
			remainingDelta -= subtractSeconds;
		}

		currentOperonId = (currentTask.fieldValues['parentTask'] ?? '').trim();
	}

	const appliedSeconds = deltaSeconds - remainingDelta;
	if (appliedSeconds <= 0) return null;

	const previewRows: EstimateReallocationPreviewRow[] = [
		{
			operonId: params.childOperonId?.trim() || '',
			label: params.childLabel?.trim() || params.childOperonId?.trim() || 'Child task',
			currentEstimateSeconds: params.persistedChildEstimateSeconds,
			newEstimateSeconds: params.draftChildEstimateSeconds,
			currentTotalEstimateSeconds: null,
			newTotalEstimateSeconds: null,
		},
	];
	let cumulativeSubtractSeconds = 0;
	for (const step of steps) {
		cumulativeSubtractSeconds += step.subtractSeconds;
		const isParent = hasChildren(step.operonId, params.getChildIds);
		const currentTotalEstimateSeconds = isParent
			? computeCurrentTreeEstimateTotal(step.operonId, params.getTaskById, params.getChildIds)
			: null;
		previewRows.push({
			operonId: step.operonId,
			label: step.label,
			currentEstimateSeconds: step.estimateBeforeSeconds,
			newEstimateSeconds: step.estimateAfterSeconds,
			currentTotalEstimateSeconds,
			newTotalEstimateSeconds: currentTotalEstimateSeconds == null
				? null
				: Math.max(0, currentTotalEstimateSeconds + deltaSeconds - cumulativeSubtractSeconds),
		});
	}

	return {
		deltaSeconds,
		childEstimateBeforeSeconds: params.persistedChildEstimateSeconds,
		childEstimateAfterSeconds: params.draftChildEstimateSeconds,
		totalAvailableSeconds: steps.reduce((sum, step) => sum + step.estimateBeforeSeconds, 0),
		appliedSeconds,
		uncoveredSeconds: remainingDelta,
		steps,
		previewRows,
		coverage: remainingDelta === 0 ? 'full' : 'partial',
	};
}

function parseEstimateSeconds(raw: string | null | undefined): number {
	return Math.max(0, parseInt(raw ?? '0', 10) || 0);
}

function hasChildren(operonId: string, getChildIds: (operonId: string) => Iterable<string>): boolean {
	for (const _childId of getChildIds(operonId)) {
		return true;
	}
	return false;
}

function computeCurrentTreeEstimateTotal(
	rootOperonId: string,
	getTaskById: (operonId: string) => IndexedTask | null,
	getChildIds: (operonId: string) => Iterable<string>,
): number {
	let total = 0;
	const stack = [rootOperonId];
	const visited = new Set<string>();

	while (stack.length > 0) {
		const operonId = stack.pop()!;
		if (visited.has(operonId)) continue;
		visited.add(operonId);

		const task = getTaskById(operonId);
		if (!task) continue;
		total += parseEstimateSeconds(task.fieldValues['estimate']);

		for (const childId of getChildIds(operonId)) {
			stack.push(childId);
		}
	}

	return total;
}
