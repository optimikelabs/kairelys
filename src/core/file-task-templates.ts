import { KeyMapping } from '../types/settings';
import { parseFrontmatterDocument, ParsedFrontmatterDocument } from './file-task-template-merge';

export interface FileTaskTemplateOption {
	id: string;
	name: string;
	path: string | null;
	kind: 'folder' | 'builtin-empty';
}

const BUILTIN_EMPTY_TEMPLATE_ID = 'builtin-empty-file-task-template';
const BUILTIN_EMPTY_TEMPLATE_NAME = 'Minimal File Template for Operon Tasks';
const BUILTIN_EMPTY_TEMPLATE_DESCRIPTION = 'Adds Operon ID, Created, Modified, Status, and Priority to the file. Preserves any other existing properties.';

function buildFolderTemplateOptionId(path: string): string {
	return `folder-file-task-template:${path}`;
}

export function getBuiltinEmptyFileTaskTemplateOption(): FileTaskTemplateOption {
	return {
		id: BUILTIN_EMPTY_TEMPLATE_ID,
		name: BUILTIN_EMPTY_TEMPLATE_NAME,
		path: null,
		kind: 'builtin-empty',
	};
}

export function getBuiltinEmptyFileTaskTemplateDescription(): string {
	return BUILTIN_EMPTY_TEMPLATE_DESCRIPTION;
}

export function getTopLevelMarkdownFilesInFolder(
	folderPath: string,
	files: ReadonlyArray<{ path: string; basename?: string; parent?: { path: string } | null }>,
): Array<{ path: string; basename: string }> {
	const normalizedFolder = folderPath.trim();
	if (!normalizedFolder) return [];

	return files
		.filter((file): file is { path: string; basename: string; parent: { path: string } } =>
			typeof file.path === 'string'
			&& typeof file.basename === 'string'
			&& !!file.parent
			&& typeof file.parent.path === 'string'
			&& file.parent.path === normalizedFolder
			&& file.path.toLowerCase().endsWith('.md')
		)
		.sort((left, right) => left.path.localeCompare(right.path))
		.map(file => ({
			path: file.path,
			basename: file.basename,
		}));
}

export function buildFileTaskTemplateOptions(
	folderPath: string,
	files: ReadonlyArray<{ path: string; basename?: string; parent?: { path: string } | null }>,
): FileTaskTemplateOption[] {
	const folderTemplates = getTopLevelMarkdownFilesInFolder(folderPath, files);
	return [
		getBuiltinEmptyFileTaskTemplateOption(),
		...folderTemplates.map(template => ({
			id: buildFolderTemplateOptionId(template.path),
			name: template.basename.trim(),
			path: template.path.trim(),
			kind: 'folder' as const,
		})),
	];
}

export function orderFileTaskTemplateOptionsByLastUsed(
	options: FileTaskTemplateOption[],
	lastUsedTemplateId: string | null | undefined,
): FileTaskTemplateOption[] {
	if (!lastUsedTemplateId) return options;
	const index = options.findIndex(option => option.id === lastUsedTemplateId);
	if (index <= 0) return options;

	const reordered = [...options];
	const [lastUsed] = reordered.splice(index, 1);
	reordered.splice(0, 0, lastUsed);
	return reordered;
}

export function resolveDefaultConvertFileTaskTemplateOption(
	folderPath: string,
	files: ReadonlyArray<{ path: string; basename?: string; parent?: { path: string } | null }>,
): FileTaskTemplateOption {
	return buildFileTaskTemplateOptions(folderPath, files)[1] ?? getBuiltinEmptyFileTaskTemplateOption();
}

export function findFileTaskTemplateOptionById(
	options: FileTaskTemplateOption[],
	id: string | null | undefined,
): FileTaskTemplateOption | null {
	if (!id) return null;
	return options.find(option => option.id === id) ?? null;
}

export async function loadFileTaskTemplateDocument(
	app: {
		vault: {
			getAbstractFileByPath: (path: string) => { path?: unknown; extension?: unknown } | null;
			cachedRead: (file: { path: string }) => Promise<string>;
		};
	},
	option: FileTaskTemplateOption | null,
	keyMappings: KeyMapping[],
): Promise<ParsedFrontmatterDocument | null> {
	if (!option || option.kind === 'builtin-empty' || !option.path) return null;

	const templateFile = app.vault.getAbstractFileByPath(option.path);
	if (
		!templateFile
		|| typeof templateFile.path !== 'string'
		|| templateFile.extension !== 'md'
	) {
		return null;
	}

	const content = await app.vault.cachedRead(templateFile as { path: string });
	return parseFrontmatterDocument(content, keyMappings);
}

export function templateDocumentContainsTemplaterSyntax(
	document: ParsedFrontmatterDocument | null | undefined,
): boolean {
	if (!document) return false;
	if (document.body.includes('<%')) return true;
	if (Object.values(document.managedFieldValues).some(value => value.includes('<%'))) return true;
	return document.sections.some(section => section.raw.includes('<%'));
}
