import { App, type HoverParent } from 'obsidian';
import { asHTMLElement, getOwnerBody } from '../core/dom-compat';

export const OPERON_COMPACT_CHIP_HOVER_SOURCE = 'operon-compact-chip';
export const OPERON_TASK_TITLE_HOVER_SOURCE = 'operon-task-title';
export const OPERON_TASK_DESCRIPTION_WIKILINK_HOVER_SOURCE = 'operon-task-description-wikilink';
const OPERON_PREVIEW_BINDINGS = Symbol('operon-preview-bindings');
const hoverParents = new WeakMap<HTMLElement, HoverParent>();

function resolveHoverParent(element: HTMLElement): HoverParent {
	const hoverParentEl = asHTMLElement(element.closest(
		'.workspace-leaf-content, .markdown-preview-view, .markdown-embed, .markdown-source-view, .modal',
	), element) ?? getOwnerBody(element);
	const existing = hoverParents.get(hoverParentEl);
	if (existing) return existing;
	const hoverParent: HoverParent = { hoverPopover: null };
	hoverParents.set(hoverParentEl, hoverParent);
	return hoverParent;
}

function bindModifierHoverLinkPreview(
	app: App,
	element: HTMLElement,
	linktext: string | null,
	sourcePath: string,
	source: string,
): void {
	if (!linktext) return;
	const bindingKey = `${source}::${linktext}`;
	const bindings = (element as HTMLElement & {
		[OPERON_PREVIEW_BINDINGS]?: Set<string>;
	})[OPERON_PREVIEW_BINDINGS] ?? new Set<string>();
	if (bindings.has(bindingKey)) return;
	bindings.add(bindingKey);
	(element as HTMLElement & {
		[OPERON_PREVIEW_BINDINGS]?: Set<string>;
	})[OPERON_PREVIEW_BINDINGS] = bindings;

	let isHovered = false;
	let previewTriggered = false;
	const triggerPreview = (event: MouseEvent): boolean => {
		if (!event.metaKey && !event.ctrlKey) return false;
		(app.workspace as unknown as {
			trigger: (name: string, payload: Record<string, unknown>) => void;
		}).trigger('hover-link', {
			event,
			source,
			targetEl: element,
			linktext,
			sourcePath,
			hoverParent: resolveHoverParent(element),
		});
		return true;
	};

	element.addEventListener('mouseover', (event) => {
		const relatedTarget = event.relatedTarget;
		if (relatedTarget && element.contains(relatedTarget as Node)) return;
		isHovered = true;
		previewTriggered = triggerPreview(event);
	});
	element.addEventListener('mousemove', (event) => {
		if (!isHovered || previewTriggered) return;
		previewTriggered = triggerPreview(event);
	});
	element.addEventListener('mouseout', (event) => {
		const relatedTarget = event.relatedTarget;
		if (relatedTarget && element.contains(relatedTarget as Node)) return;
		isHovered = false;
		previewTriggered = false;
	});
}

export function bindCompactChipLinkPreview(
	app: App,
	element: HTMLElement,
	linktext: string | null,
	sourcePath: string,
): void {
	bindModifierHoverLinkPreview(app, element, linktext, sourcePath, OPERON_COMPACT_CHIP_HOVER_SOURCE);
}

export function bindTaskTitleLinkPreview(
	app: App,
	element: HTMLElement,
	filePath: string | null,
	hoverSourcePath?: string,
): void {
	bindModifierHoverLinkPreview(
		app,
		element,
		filePath,
		hoverSourcePath ?? filePath ?? '',
		OPERON_TASK_TITLE_HOVER_SOURCE,
	);
}

export function bindTaskDescriptionWikilinkPreview(
	app: App,
	element: HTMLElement,
	linktext: string | null,
	sourcePath: string,
): void {
	bindModifierHoverLinkPreview(app, element, linktext, sourcePath, OPERON_TASK_DESCRIPTION_WIKILINK_HOVER_SOURCE);
}
