import type { IndexedTask } from '../types/fields';
import type { Pipeline } from '../types/pipeline';
import { resolveWorkflowStatus } from '../types/pipeline';

export function shouldAutoUnpinTerminalTask(task: IndexedTask, pipelines: Pipeline[]): boolean {
	const workflow = resolveWorkflowStatus(pipelines, task.fieldValues['status']);
	if (workflow?.definition.isFinished === true || workflow?.definition.isCancelled === true) {
		return true;
	}
	if (task.checkbox === 'done' || task.checkbox === 'cancelled') {
		return true;
	}
	return (task.fieldValues['dateCompleted'] ?? '').trim().length > 0
		|| (task.fieldValues['dateCancelled'] ?? '').trim().length > 0;
}
