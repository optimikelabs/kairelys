import { isTaskLineCandidate } from './parser';
import { splitFrontmatterDocument } from './file-task-template-merge';

export interface ResolveOperonIdPlaceholdersOptions {
	generateOperonId: () => string;
}

const PLACEHOLDER_PATTERN = /\{\{operonId([0-9A-Za-z]?)\}\}/g;

function generateUniqueLocalOperonId(
	generateOperonId: () => string,
	usedIds: Set<string>,
): string {
	for (let attempt = 0; attempt < 100; attempt++) {
		const next = generateOperonId();
		if (usedIds.has(next)) continue;
		usedIds.add(next);
		return next;
	}
	throw new Error('Failed to generate unique local operonId placeholder after 100 attempts');
}

function replaceYamlPlaceholders(
	frontmatter: string,
	options: ResolveOperonIdPlaceholdersOptions,
	usedIds: Set<string>,
	stableIds: Map<string, string>,
): string {
	return frontmatter.replace(PLACEHOLDER_PATTERN, (_match, suffix: string) => {
		if (!suffix) {
			return generateUniqueLocalOperonId(options.generateOperonId, usedIds);
		}

		const existing = stableIds.get(suffix);
		if (existing) return existing;
		const next = generateUniqueLocalOperonId(options.generateOperonId, usedIds);
		stableIds.set(suffix, next);
		return next;
	});
}

function replaceCheckboxLinePlaceholders(
	body: string,
	options: ResolveOperonIdPlaceholdersOptions,
	usedIds: Set<string>,
	stableIds: Map<string, string>,
): string {
	const lines = body.split('\n');
	let inFencedCodeBlock = false;

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? '';

		if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
			inFencedCodeBlock = !inFencedCodeBlock;
			continue;
		}
		if (inFencedCodeBlock) continue;
		if (!isTaskLineCandidate(line)) continue;
		if (!line.includes('{{operonId')) continue;

		lines[index] = line.replace(PLACEHOLDER_PATTERN, (_match, suffix: string) => {
			if (!suffix) {
				return generateUniqueLocalOperonId(options.generateOperonId, usedIds);
			}

			const existing = stableIds.get(suffix);
			if (existing) return existing;
			const next = generateUniqueLocalOperonId(options.generateOperonId, usedIds);
			stableIds.set(suffix, next);
			return next;
		});
	}

	return lines.join('\n');
}

export function resolveOperonIdPlaceholdersInTaskBlock(
	content: string,
	options: ResolveOperonIdPlaceholdersOptions,
): string {
	if (!content.includes('{{operonId')) return content;
	return replaceCheckboxLinePlaceholders(content, options, new Set<string>(), new Map<string, string>());
}

export function resolveOperonIdPlaceholders(
	content: string,
	options: ResolveOperonIdPlaceholdersOptions,
): string {
	if (!content.includes('{{operonId')) return content;

	const { frontmatter, body } = splitFrontmatterDocument(content);
	const usedIds = new Set<string>();
	const stableIds = new Map<string, string>();
	const nextFrontmatter = frontmatter == null
		? null
		: replaceYamlPlaceholders(frontmatter, options, usedIds, stableIds);
	const nextBody = replaceCheckboxLinePlaceholders(body, options, usedIds, stableIds);

	if (nextFrontmatter == null) return nextBody;
	return `---\n${nextFrontmatter}\n---\n${nextBody}`;
}
