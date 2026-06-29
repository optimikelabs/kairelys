import { parseLinktext } from 'obsidian';
import { scanTaskWikiLinksInLine } from './task-wikilink-scanner';

export interface TaskWikilinkOverlayRewriteTarget {
	operonId: string;
	filePath: string;
	basename: string;
}

export interface TaskWikilinkOverlayRewriteReplacement {
	from: number;
	to: number;
	text: string;
	operonId: string;
}

export interface TaskWikilinkOverlayRewriteResult {
	content: string;
	replacements: TaskWikilinkOverlayRewriteReplacement[];
	rewrittenLinkCount: number;
	rewrittenOperonIds: string[];
}

export interface TaskWikilinkOverlayRewriteOptions {
	targetsByOperonId: ReadonlyMap<string, TaskWikilinkOverlayRewriteTarget>;
	escapeTarget: (target: string) => string;
}

interface FrontmatterState {
	inside: boolean;
	closed: boolean;
}

interface FenceState {
	active: boolean;
	marker: string;
	length: number;
}

export function rewriteTaskWikilinkOverlayLinksInContent(
	content: string,
	options: TaskWikilinkOverlayRewriteOptions,
): TaskWikilinkOverlayRewriteResult {
	const replacements: TaskWikilinkOverlayRewriteReplacement[] = [];
	const rewrittenOperonIds = new Set<string>();
	const firstLineEnd = content.indexOf('\n');
	const firstLine = content.slice(0, firstLineEnd === -1 ? content.length : firstLineEnd).trim();
	const frontmatterState: FrontmatterState = {
		inside: firstLine === '---',
		closed: firstLine !== '---',
	};
	const fenceState: FenceState = {
		active: false,
		marker: '',
		length: 0,
	};

	let lineStart = 0;
	while (lineStart <= content.length) {
		const newlineIndex = content.indexOf('\n', lineStart);
		const lineEnd = newlineIndex === -1 ? content.length : newlineIndex;
		const line = content.slice(lineStart, lineEnd);
		const shouldScan = shouldScanTaskWikilinkOverlayLine(line, lineStart, frontmatterState, fenceState);
		if (shouldScan) {
			for (const match of scanTaskWikiLinksInLine(line, { includeEmbeds: true })) {
				const replacement = buildTaskWikilinkOverlayReplacement(match.linktext, match.alias, options);
				if (!replacement) continue;
				replacements.push({
					from: lineStart + match.from + 2,
					to: lineStart + match.to - 2,
					text: replacement.text,
					operonId: replacement.operonId,
				});
				rewrittenOperonIds.add(replacement.operonId);
			}
		}

		if (newlineIndex === -1) break;
		lineStart = newlineIndex + 1;
	}

	if (replacements.length === 0) {
		return {
			content,
			replacements: [],
			rewrittenLinkCount: 0,
			rewrittenOperonIds: [],
		};
	}

	let rewrittenContent = content;
	for (let i = replacements.length - 1; i >= 0; i--) {
		const replacement = replacements[i];
		rewrittenContent = `${rewrittenContent.slice(0, replacement.from)}${replacement.text}${rewrittenContent.slice(replacement.to)}`;
	}

	return {
		content: rewrittenContent,
		replacements,
		rewrittenLinkCount: replacements.length,
		rewrittenOperonIds: [...rewrittenOperonIds],
	};
}

function shouldScanTaskWikilinkOverlayLine(
	line: string,
	lineStart: number,
	frontmatterState: FrontmatterState,
	fenceState: FenceState,
): boolean {
	const trimmed = line.trim();

	if (frontmatterState.inside) {
		if (lineStart > 0 && (trimmed === '---' || trimmed === '...')) {
			frontmatterState.inside = false;
			frontmatterState.closed = true;
		}
		return false;
	}

	if (!frontmatterState.closed) {
		frontmatterState.closed = true;
	}

	const fenceMarker = getMarkdownFenceMarker(trimmed);
	if (fenceState.active) {
		if (fenceMarker && fenceMarker.marker === fenceState.marker && fenceMarker.length >= fenceState.length) {
			fenceState.active = false;
			fenceState.marker = '';
			fenceState.length = 0;
		}
		return false;
	}

	if (fenceMarker) {
		fenceState.active = true;
		fenceState.marker = fenceMarker.marker;
		fenceState.length = fenceMarker.length;
		return false;
	}

	return true;
}

function getMarkdownFenceMarker(trimmedLine: string): { marker: string; length: number } | null {
	if (!trimmedLine.startsWith('```') && !trimmedLine.startsWith('~~~')) return null;
	const marker = trimmedLine[0];
	let length = 0;
	while (trimmedLine[length] === marker) length++;
	return length >= 3 ? { marker, length } : null;
}

function buildTaskWikilinkOverlayReplacement(
	linktext: string,
	alias: string | null,
	options: TaskWikilinkOverlayRewriteOptions,
): { text: string; operonId: string } | null {
	const { path, subpath } = parseLinktext(linktext.trim());
	if (!path || !subpath) return null;

	const operonId = parseInlineTaskWikilinkOperonId(subpath);
	if (!operonId) return null;

	const target = options.targetsByOperonId.get(operonId);
	if (!target) return null;

	const targetLinkPath = shouldPreserveFullPathStyle(path)
		? stripMarkdownExtension(target.filePath)
		: target.basename;
	const nextLinktext = `${options.escapeTarget(targetLinkPath)}#-${operonId}`;
	if (nextLinktext === linktext.trim()) return null;

	return {
		text: alias ? `${nextLinktext}|${alias}` : nextLinktext,
		operonId,
	};
}

function parseInlineTaskWikilinkOperonId(subpath: string): string | null {
	const normalized = subpath
		.trim()
		.replace(/^#/u, '')
		.trim();
	if (!normalized.startsWith('-')) return null;
	const operonId = normalized.slice(1).trim();
	return operonId || null;
}

function shouldPreserveFullPathStyle(path: string): boolean {
	return path.includes('/');
}

function stripMarkdownExtension(filePath: string): string {
	return filePath.replace(/\.md$/iu, '');
}
