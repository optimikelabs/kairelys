import { App } from 'obsidian';
import {
	asHTMLElement,
	createOwnerElement,
	getActiveDocument,
	getActiveWindow,
	getOwnerBody,
	getOwnerDocument,
	getOwnerWindow,
} from '../../core/dom-compat';
import { getWindowApp } from '../../core/obsidian-app';

export interface FloatingPanel {
	panel: HTMLElement;
	close: () => void;
}

interface FloatingPanelRecord {
	panel: HTMLElement;
	anchorEl: HTMLElement | null;
	close: () => void;
}

export interface FloatingPositionOptions {
	gap?: number;
	margin?: number;
	matchWidth?: number;
}

export interface FloatingPanelOptions {
	retainInputFocus?: boolean;
	focusInputSelector?: string;
}

interface FloatingHostContext {
	host: HTMLElement;
	constrainToHost: boolean;
	scrollHost: HTMLElement | Window;
}

const activeFloatingPanels = new Set<FloatingPanelRecord>();

function isEditablePanelFocus(element: Element | null, panel: HTMLElement): boolean {
	const htmlElement = asHTMLElement(element, panel);
	if (!htmlElement || !panel.contains(htmlElement)) return false;
	return htmlElement.matches('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]');
}

export function resolvePickerApp(anchor: HTMLElement | DOMRect, app?: App): App | undefined {
	if (app) return app;
	const anchorEl = asHTMLElement(anchor);
	return getWindowApp(anchorEl ? getOwnerWindow(anchorEl) : getActiveWindow());
}

function resolveRect(anchor: HTMLElement | DOMRect): DOMRect {
	const anchorEl = asHTMLElement(anchor);
	if (anchorEl) return anchorEl.getBoundingClientRect();
	return anchor as DOMRect;
}

function resolveHostContext(anchor: HTMLElement | DOMRect): FloatingHostContext {
	const anchorEl = asHTMLElement(anchor);
	if (!anchorEl) {
		return { host: getActiveDocument().body, constrainToHost: false, scrollHost: getActiveWindow() };
	}
	const ownerWindow = getOwnerWindow(anchorEl);

	const taskEditorHost = asHTMLElement(anchorEl.closest(
		'.operon-task-editor-shell',
	), anchorEl);
	if (taskEditorHost) {
		return {
			host: taskEditorHost,
			constrainToHost: true,
			scrollHost: asHTMLElement(anchorEl.closest('.operon-task-editor-main-panel'), anchorEl) ?? ownerWindow,
		};
	}

	const taskCreatorHost = asHTMLElement(anchorEl.closest(
		'.operon-task-creator-modal-container, .operon-task-creator-modal',
	), anchorEl);
	if (taskCreatorHost) {
		return { host: taskCreatorHost, constrainToHost: false, scrollHost: ownerWindow };
	}

	const obsidianModalHost = asHTMLElement(anchorEl.closest('.modal'), anchorEl);
	if (obsidianModalHost) {
		return {
			host: obsidianModalHost,
			constrainToHost: false,
			scrollHost: asHTMLElement(anchorEl.closest('.vertical-tab-content, .modal-content'), anchorEl) ?? ownerWindow,
		};
	}

	return { host: getOwnerBody(anchorEl), constrainToHost: false, scrollHost: ownerWindow };
}

export function positionFloatingElement(
	panel: HTMLElement,
	anchor: HTMLElement | DOMRect,
	options: FloatingPositionOptions = {},
): void {
	const rect = resolveRect(anchor);
	const { host, constrainToHost } = resolveHostContext(anchor);
	const hostWindow = getOwnerWindow(host);
	const hostIsBody = host === getOwnerBody(host);
	const margin = options.margin ?? 8;
	const gap = options.gap ?? 6;
	const useHostBounds = constrainToHost && !hostIsBody;
	const DOMRectCtor = (hostWindow as Window & { DOMRect?: typeof DOMRect }).DOMRect ?? DOMRect;
	const hostRect = useHostBounds
		? host.getBoundingClientRect()
		: new DOMRectCtor(0, 0, hostWindow.innerWidth, hostWindow.innerHeight);
	const hostScrollLeft = useHostBounds ? host.scrollLeft : 0;
	const hostScrollTop = useHostBounds ? host.scrollTop : 0;
	const anchorLeft = useHostBounds ? rect.left - hostRect.left + hostScrollLeft : rect.left;
	const anchorTop = useHostBounds ? rect.top - hostRect.top + hostScrollTop : rect.top;
	const anchorBottom = useHostBounds ? rect.bottom - hostRect.top + hostScrollTop : rect.bottom;
	const availableWidth = useHostBounds ? host.clientWidth : hostWindow.innerWidth;
	const availableHeight = useHostBounds ? host.clientHeight : hostWindow.innerHeight;
	if (typeof options.matchWidth === 'number' && options.matchWidth > 0) {
		panel.style.width = `${Math.round(options.matchWidth)}px`;
	}
	const panelWidth = panel.offsetWidth;
	const panelHeight = panel.offsetHeight;

	const maxHeight = Math.max(160, availableHeight - margin * 2);
	panel.style.maxHeight = `${maxHeight}px`;
	panel.style.overflowY = panelHeight > maxHeight ? 'auto' : '';

	const effectiveHeight = Math.min(panel.offsetHeight, maxHeight);
	const spaceBelow = availableHeight - anchorBottom - margin;
	const spaceAbove = anchorTop - margin;

	let top = anchorBottom + gap;
	if (effectiveHeight > spaceBelow && spaceAbove > spaceBelow) {
		top = anchorTop - effectiveHeight - gap;
	}
	top = Math.max(margin, Math.min(top, availableHeight - effectiveHeight - margin));

	let left = anchorLeft;
	if (left + panelWidth > availableWidth - margin) {
		left = availableWidth - panelWidth - margin;
	}
	left = Math.max(margin, left);

	if (useHostBounds) {
		const minLeft = hostScrollLeft + margin;
		const maxLeft = hostScrollLeft + availableWidth - panelWidth - margin;
		const minTop = hostScrollTop + margin;
		const maxTop = hostScrollTop + availableHeight - effectiveHeight - margin;
		left = Math.max(minLeft, Math.min(left, maxLeft));
		top = Math.max(minTop, Math.min(top, maxTop));
	}

	panel.style.top = `${Math.round(top)}px`;
	panel.style.left = `${Math.round(left)}px`;
}

export function createFloatingPanel(
	anchor: HTMLElement | DOMRect,
	className: string,
	onClose?: () => void,
	options: FloatingPanelOptions = {},
): FloatingPanel {
	const anchorEl = asHTMLElement(anchor);
	const panel = createOwnerElement(anchorEl, 'div');
	panel.className = className;
	const { host, constrainToHost, scrollHost } = resolveHostContext(anchor);
	const hostDocument = getOwnerDocument(host);
	const hostWindow = getOwnerWindow(host);
	panel.style.position = constrainToHost ? 'absolute' : 'fixed';
	let rafId = 0;
	let focusRetentionTimer = 0;
	let retainedFocusInput: HTMLElement | null = null;
	let closed = false;
	const record: FloatingPanelRecord = {
		panel,
		anchorEl,
		close: () => undefined,
	};
	const isAnchorConnected = (): boolean => !anchorEl || anchorEl.isConnected;
	const schedulePosition = () => {
		if (rafId) return;
		rafId = hostWindow.requestAnimationFrame(() => {
			rafId = 0;
			if (!panel.isConnected) return;
			if (!isAnchorConnected()) {
				cleanup();
				return;
			}
			positionFloatingElement(panel, anchor);
		});
	};
	const sizeObserver = new ResizeObserver(() => schedulePosition());
	const getRetainedFocusInput = (): HTMLElement | null => {
		if (retainedFocusInput?.isConnected && panel.contains(retainedFocusInput)) {
			return retainedFocusInput;
		}
		return panel.querySelector<HTMLElement>(options.focusInputSelector ?? '.operon-floating-input');
	};
	const retainInputFocus = () => {
		if (closed || !panel.isConnected) return;
		const input = getRetainedFocusInput();
		if (input?.isConnected) {
			const activeElement = hostDocument.activeElement;
			if (activeElement !== input && !isEditablePanelFocus(activeElement, panel)) {
				input.focus({ preventScroll: true });
			}
		}
		focusRetentionTimer = hostWindow.setTimeout(retainInputFocus, 120);
	};
	const onPanelFocusIn = (event: FocusEvent) => {
		const target = asHTMLElement(event.target, panel);
		if (!target || !isEditablePanelFocus(target, panel)) return;
		retainedFocusInput = target;
	};

	const cleanup = () => {
		if (closed) return;
		closed = true;
		if (rafId) {
			hostWindow.cancelAnimationFrame(rafId);
			rafId = 0;
		}
		if (focusRetentionTimer) {
			hostWindow.clearTimeout(focusRetentionTimer);
			focusRetentionTimer = 0;
		}
		sizeObserver.disconnect();
		panel.remove();
		activeFloatingPanels.delete(record);
		panel.removeEventListener('focusin', onPanelFocusIn);
		hostDocument.removeEventListener('mousedown', onOutside, true);
		hostDocument.removeEventListener('keydown', onKeyDown, true);
		scrollHost.removeEventListener('scroll', schedulePosition, true);
		hostWindow.removeEventListener('resize', cleanup);
		hostWindow.removeEventListener('blur', cleanup);
		onClose?.();
	};
	record.close = cleanup;

	const onOutside = (event: MouseEvent) => {
		if (!panel.contains(event.target as Node)) {
			cleanup();
		}
	};

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') cleanup();
	};

	host.appendChild(panel);
	activeFloatingPanels.add(record);
	if (options.retainInputFocus) {
		panel.addEventListener('focusin', onPanelFocusIn);
		focusRetentionTimer = hostWindow.setTimeout(retainInputFocus, 0);
	}

	hostWindow.requestAnimationFrame(() => {
		if (!panel.isConnected) return;
		if (!isAnchorConnected()) {
			cleanup();
			return;
		}
		positionFloatingElement(panel, anchor);
		sizeObserver.observe(panel);
		hostDocument.addEventListener('mousedown', onOutside, true);
		hostDocument.addEventListener('keydown', onKeyDown, true);
		scrollHost.addEventListener('scroll', schedulePosition, true);
		hostWindow.addEventListener('resize', cleanup);
		hostWindow.addEventListener('blur', cleanup);
	});
	return { panel, close: cleanup };
}

export function focusFloatingInput(input: HTMLElement): void {
	input.focus({ preventScroll: true });
}

export function requestFloatingInputFocus(input: HTMLElement): void {
	const ownerWindow = getOwnerWindow(input);
	ownerWindow.requestAnimationFrame(() => {
		if (!input.isConnected) return;
		focusFloatingInput(input);
	});
}

export function scrollChildIntoView(container: HTMLElement, child: HTMLElement | null | undefined, margin = 4): void {
	if (!child?.isConnected || !container.contains(child)) return;

	const containerRect = container.getBoundingClientRect();
	const childRect = child.getBoundingClientRect();
	const topOverflow = childRect.top - containerRect.top - margin;
	const bottomOverflow = childRect.bottom - containerRect.bottom + margin;

	if (topOverflow < 0) {
		container.scrollTop += topOverflow;
	} else if (bottomOverflow > 0) {
		container.scrollTop += bottomOverflow;
	}
}

export function closeFloatingPanelsForRoot(root: ParentNode): void {
	const rootNode = root as Node;
	for (const record of Array.from(activeFloatingPanels)) {
		if (
			rootNode.contains(record.panel)
			|| (record.anchorEl && rootNode.contains(record.anchorEl))
			|| (record.anchorEl && !record.anchorEl.isConnected)
		) {
			record.close();
		}
	}
}

export function createButton(label: string, className: string, owner?: Node | null): HTMLButtonElement {
	const button = createOwnerElement(owner, 'button');
	button.type = 'button';
	button.className = className;
	button.textContent = label;
	return button;
}

export function createChip(label: string, className: string, owner?: Node | null): HTMLElement {
	const chip = createOwnerElement(owner, 'span');
	chip.className = className;
	chip.textContent = label;
	return chip;
}
