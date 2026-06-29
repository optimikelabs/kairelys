import type { Editor } from 'obsidian';
import type { IndexedTask } from '../types/fields';

type TaskWikilinkOverlayTask = Pick<IndexedTask, 'operonId'> & {
	primary: Pick<IndexedTask['primary'], 'format'>;
};

export type TaskWikilinkOverlayEditor = Pick<Editor, 'replaceSelection'>;

export function buildTaskWikilinkOverlayLink(
	task: TaskWikilinkOverlayTask,
	sourceBasename: string,
	escapeTarget: (target: string) => string,
): string | null {
	const basename = sourceBasename.trim();
	if (!basename) return null;

	const fileTarget = escapeTarget(basename);
	if (!fileTarget) return null;

	if (task.primary.format === 'inline') {
		const operonId = task.operonId.trim();
		if (!operonId) return null;
		return `[[${fileTarget}#-${operonId}]]`;
	}

	return `[[${fileTarget}]]`;
}

export function insertTaskWikilinkOverlayLink(editor: TaskWikilinkOverlayEditor, wikilink: string): void {
	editor.replaceSelection(wikilink);
}
