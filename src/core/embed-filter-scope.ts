import type { IndexedTask } from '../types/fields';

export type EmbeddedFilterScope = 'vault' | 'current-folder';

export interface EmbeddedFilterReference {
	filterId: string | null;
	filterName: string | null;
	scope: EmbeddedFilterScope;
}

/**
 * Parse an embedded Operon filter block.
 *
 * The optional scope keeps the saved filter reusable while allowing a note
 * template to constrain the rendered tasks to the note's own folder tree.
 */
export function parseEmbeddedFilterReference(source: string): EmbeddedFilterReference | null {
	let filterId: string | null = null;
	let filterName: string | null = null;
	let scope: EmbeddedFilterScope = 'vault';

	for (const line of source.split('\n')) {
		const trimmed = line.trim();
		const idMatch = trimmed.match(/^filterId:\s*["']?(.+?)["']?\s*$/i);
		if (idMatch) filterId = idMatch[1];

		const nameMatch = trimmed.match(/^filter:\s*["']?(.+?)["']?\s*$/i);
		if (nameMatch) filterName = nameMatch[1];

		const scopeMatch = trimmed.match(/^scope:\s*["']?(.+?)["']?\s*$/i);
		if (scopeMatch) {
			const normalizedScope = scopeMatch[1].trim().toLocaleLowerCase();
			if (normalizedScope !== 'vault' && normalizedScope !== 'current-folder') return null;
			scope = normalizedScope;
		}
	}

	if (!filterId && !filterName) return null;
	return { filterId, filterName, scope };
}

export function resolveEmbeddedFilterSourceFolder(sourcePath: string): string | null {
	const normalizedPath = normalizeVaultPath(sourcePath);
	const lastSlashIndex = normalizedPath.lastIndexOf('/');
	if (lastSlashIndex <= 0) return null;
	return normalizedPath.slice(0, lastSlashIndex);
}

export function filterTasksToFolderTree(
	tasks: readonly IndexedTask[],
	folderPath: string,
): IndexedTask[] {
	const normalizedFolder = normalizeVaultPath(folderPath).toLocaleLowerCase();
	if (!normalizedFolder) return [];

	return tasks.filter((task) => {
		const normalizedFilePath = normalizeVaultPath(task.primary.filePath).toLocaleLowerCase();
		return normalizedFilePath.startsWith(`${normalizedFolder}/`);
	});
}

function normalizeVaultPath(path: string): string {
	return path
		.replace(/\\/g, '/')
		.trim()
		.replace(/^\/+|\/+$/g, '');
}
