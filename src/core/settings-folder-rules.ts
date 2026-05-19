export function normalizeSettingsFolderPath(value: string | null | undefined): string {
	if (typeof value !== 'string') return '';
	return value.trim().replace(/^\/+|\/+$/g, '');
}

function isSameOrParentFolder(candidateFolder: string, childFolder: string): boolean {
	const candidate = normalizeSettingsFolderPath(candidateFolder).toLowerCase();
	const child = normalizeSettingsFolderPath(childFolder).toLowerCase();
	if (!candidate || !child) return false;
	return candidate === child || child.startsWith(`${candidate}/`);
}

export function isExcludedFolderConflictWithFileTasksFolder(
	excludedFolderPath: string,
	fileTasksFolder: string,
): boolean {
	return isSameOrParentFolder(excludedFolderPath, fileTasksFolder);
}

export function sanitizeExcludedFoldersForFileTasksFolder(
	excludedFolders: string[],
	fileTasksFolder: string,
): string[] {
	const seen = new Set<string>();
	const folders: string[] = [];
	for (const folder of excludedFolders) {
		const normalized = normalizeSettingsFolderPath(folder);
		if (!normalized) continue;
		if (isExcludedFolderConflictWithFileTasksFolder(normalized, fileTasksFolder)) continue;
		const duplicateKey = normalized.toLowerCase();
		if (seen.has(duplicateKey)) continue;
		seen.add(duplicateKey);
		folders.push(normalized);
	}
	return folders;
}
