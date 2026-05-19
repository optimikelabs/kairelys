import { setIcon } from 'obsidian';
import { localNow } from '../core/local-time';
import {
	resolveContextualMenu,
	type ContextualMenuActionHandler,
	type ContextualMenuContext,
	type ContextualMenuSurface,
	type ContextualTaskActionSource,
	type ResolvedContextualMenuAction,
} from '../core/contextual-menu-engine';
import type { OperonSettings } from '../types/settings';
import {
	WindowTimeoutHandle,
	clearWindowTimeout,
	getOwnerBody,
	getOwnerDocument,
	getOwnerWindow,
	setWindowTimeout,
} from '../core/dom-compat';
import { resolveContextualHoverMenuPosition } from './contextual-hover-menu-position';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';

interface ContextualHoverMenuBindOptions {
	surface: ContextualMenuSurface;
	taskId: string;
	getTask: () => ContextualTaskActionSource | null;
	getSettings: () => Pick<OperonSettings, 'contextualMenuActionAllowlist' | 'contextualMenuSurfaceActionMatrix' | 'contextualMenuOpenDelayMs'>;
	onAction: ContextualMenuActionHandler;
	isPinned?: () => boolean;
	resolveAnchorRect?: () => DOMRect;
}

interface ContextualHoverMenuControllerOptions {
	getDelayMs: () => number;
	getHost?: () => HTMLElement | null;
	positionMenu: (anchorRect: DOMRect, menu: HTMLElement) => boolean;
	menuClassName?: string;
	menuPosition?: 'fixed';
}

interface ContextualHoverMenuShowOptions {
	key: string;
	taskId: string;
	actions: ResolvedContextualMenuAction[];
	anchorRect: DOMRect;
	host?: HTMLElement | null;
	context?: ContextualMenuContext;
	onAction: ContextualMenuActionHandler;
}

export class ContextualHoverMenuController {
	private readonly options: ContextualHoverMenuControllerOptions;
	private activeMenuEl: HTMLElement | null = null;
	private activeKey: string | null = null;
	private activeMenuHideTimer: WindowTimeoutHandle | null = null;
	private activeMenuShowTimer: WindowTimeoutHandle | null = null;
	private activeMenuDocument: Document | null = null;
	private activeMenuWindow: Window | null = null;
	private activeMenuKeydownHandler: ((event: KeyboardEvent) => void) | null = null;
	private activeMenuScrollHandler: ((event: Event) => void) | null = null;
	private activeMenuResizeHandler: (() => void) | null = null;

	constructor(options: ContextualHoverMenuControllerOptions) {
		this.options = options;
	}

	isActive(key: string): boolean {
		return this.activeKey === key && !!this.activeMenuEl;
	}

	contains(target: EventTarget | null): boolean {
		const menu = this.activeMenuEl;
		if (!menu || typeof target !== 'object' || target === null) return false;
		const ownerWindow = getOwnerWindow(menu) as Window & { Node?: typeof Node };
		const NodeCtor = ownerWindow.Node;
		if (!NodeCtor || !Object.prototype.isPrototypeOf.call(NodeCtor.prototype, target)) return false;
		return menu.contains(target as Node);
	}

	clearShowTimer(): void {
		if (this.activeMenuShowTimer === null) return;
		clearWindowTimeout(this.activeMenuShowTimer);
		this.activeMenuShowTimer = null;
	}

	clearHideTimer(): void {
		if (this.activeMenuHideTimer === null) return;
		clearWindowTimeout(this.activeMenuHideTimer);
		this.activeMenuHideTimer = null;
	}

	scheduleShow(callback: () => void): void {
		this.clearShowTimer();
		const delay = Math.max(0, this.options.getDelayMs());
		this.activeMenuShowTimer = setWindowTimeout(() => {
			this.activeMenuShowTimer = null;
			callback();
		}, delay);
	}

	scheduleHide(): void {
		if (!this.activeMenuEl) return;
		this.clearHideTimer();
		const delay = Math.max(0, this.options.getDelayMs());
		this.activeMenuHideTimer = setWindowTimeout(() => {
			this.activeMenuHideTimer = null;
			this.hide(true);
		}, delay);
	}

	hide(immediate = true): void {
		if (!immediate) {
			this.scheduleHide();
			return;
		}
		this.clearShowTimer();
		this.clearHideTimer();
		this.activeMenuEl?.remove();
		this.activeMenuEl = null;
		this.activeKey = null;
		if (this.activeMenuKeydownHandler) {
			this.activeMenuDocument?.removeEventListener('keydown', this.activeMenuKeydownHandler, true);
			this.activeMenuKeydownHandler = null;
		}
		if (this.activeMenuScrollHandler) {
			this.activeMenuDocument?.removeEventListener('scroll', this.activeMenuScrollHandler, true);
			this.activeMenuScrollHandler = null;
		}
		if (this.activeMenuResizeHandler) {
			this.activeMenuWindow?.removeEventListener('resize', this.activeMenuResizeHandler, true);
			this.activeMenuResizeHandler = null;
		}
		this.activeMenuDocument = null;
		this.activeMenuWindow = null;
	}

	show(options: ContextualHoverMenuShowOptions): void {
		if (options.actions.length === 0) {
			if (this.activeKey === options.key) this.hide(true);
			return;
		}

		this.clearHideTimer();
		if (this.isActive(options.key) && this.activeMenuEl) {
			if (!this.options.positionMenu(options.anchorRect, this.activeMenuEl)) {
				this.hide(true);
			}
			return;
		}

		this.hide(true);
		const host = options.host ?? this.options.getHost?.() ?? null;
		if (!host) return;
		const hostDocument = getOwnerDocument(host);

		const menu = hostDocument.createElement('div');
		menu.className = this.options.menuClassName ?? 'operon-calendar-hover-menu';
		menu.tabIndex = -1;
		if (this.options.menuPosition) {
			menu.style.position = this.options.menuPosition;
		}
		menu.addEventListener('pointerenter', () => this.clearHideTimer());
		menu.addEventListener('pointerleave', () => this.scheduleHide());
		menu.addEventListener('pointerdown', event => {
			event.preventDefault();
			event.stopPropagation();
		});

		for (const action of options.actions) {
			const button = hostDocument.createElement('button');
			button.className = 'operon-calendar-hover-menu-item';
			button.type = 'button';
			button.setAttribute('data-action-id', action.id);

			const iconWrap = hostDocument.createElement('span');
			iconWrap.className = 'operon-calendar-hover-menu-icon';
			setIcon(iconWrap, action.icon);
			button.appendChild(iconWrap);

			const label = hostDocument.createElement('span');
			label.className = 'operon-calendar-hover-menu-label';
			label.textContent = action.label;
			button.appendChild(label);
			setAccessibleLabelWithoutTooltip(button, action.label);

			button.addEventListener('click', event => {
				event.preventDefault();
				event.stopPropagation();
				this.hide(true);
				void options.onAction(options.taskId, action.id, options.context);
			});

			menu.appendChild(button);
		}

		host.appendChild(menu);
		this.activeMenuEl = menu;
		this.activeKey = options.key;
		this.activeMenuDocument = hostDocument;
		this.activeMenuWindow = getOwnerWindow(menu);
		this.activeMenuKeydownHandler = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			this.hide(true);
		};
		this.activeMenuScrollHandler = (event: Event) => {
			if (this.contains(event.target)) return;
			this.hide(true);
		};
		this.activeMenuResizeHandler = () => {
			this.hide(true);
		};
		hostDocument.addEventListener('keydown', this.activeMenuKeydownHandler, true);
		hostDocument.addEventListener('scroll', this.activeMenuScrollHandler, true);
		this.activeMenuWindow.addEventListener('resize', this.activeMenuResizeHandler, true);
		if (!this.options.positionMenu(options.anchorRect, menu)) {
			this.hide(true);
		}
	}
}

let sharedHoverMenuDelayMs = 0;

const sharedTaskHoverMenu = new ContextualHoverMenuController({
	getDelayMs: () => sharedHoverMenuDelayMs,
	menuClassName: 'operon-calendar-hover-menu operon-contextual-hover-menu',
	menuPosition: 'fixed',
	positionMenu: (anchorRect, menu) => {
		const ownerWindow = getOwnerWindow(menu);
		const menuRect = menu.getBoundingClientRect();
		const position = resolveContextualHoverMenuPosition(
			anchorRect,
			{
				left: 0,
				top: 0,
				right: ownerWindow.innerWidth,
				bottom: ownerWindow.innerHeight,
				width: ownerWindow.innerWidth,
				height: ownerWindow.innerHeight,
			},
			menuRect,
		);
		if (!position) return false;
		menu.style.left = `${position.left}px`;
		menu.style.top = `${position.top}px`;
		menu.style.width = `${position.width}px`;
		menu.style.maxHeight = `${Math.floor(position.maxHeight)}px`;
		return true;
	},
});

export function hideTaskContextualHoverMenu(immediate = true): void {
	sharedTaskHoverMenu.hide(immediate);
}

export function bindTaskContextualHoverMenu(
	triggerEl: HTMLElement,
	options: ContextualHoverMenuBindOptions,
): () => void {
	let showTimer: WindowTimeoutHandle | null = null;
	const menuKey = `${options.surface}:${options.taskId}`;

	const clearShowTimer = (): void => {
		if (showTimer === null) return;
		clearWindowTimeout(showTimer);
		showTimer = null;
	};

	const openMenu = (): void => {
		const task = options.getTask();
		if (!task) return;
		sharedHoverMenuDelayMs = Math.max(0, options.getSettings().contextualMenuOpenDelayMs);
		const context: ContextualMenuContext = {
			surface: options.surface,
			taskId: options.taskId,
			task,
			now: localNow(),
			isPinned: options.isPinned?.(),
		};
		const settings = options.getSettings();
		const actions = resolveContextualMenu(
			context,
			settings.contextualMenuActionAllowlist,
			settings.contextualMenuSurfaceActionMatrix,
		);
		sharedTaskHoverMenu.show({
			key: menuKey,
			taskId: options.taskId,
			actions,
			anchorRect: options.resolveAnchorRect?.() ?? triggerEl.getBoundingClientRect(),
			host: getOwnerBody(triggerEl),
			context,
			onAction: options.onAction,
		});
	};

	const handlePointerEnter = (): void => {
		if (sharedTaskHoverMenu.isActive(menuKey)) {
			sharedTaskHoverMenu.clearHideTimer();
			return;
		}
		clearShowTimer();
		const delay = Math.max(0, options.getSettings().contextualMenuOpenDelayMs);
		showTimer = setWindowTimeout(() => {
			showTimer = null;
			openMenu();
		}, delay);
	};

	const handlePointerLeave = (event: PointerEvent): void => {
		clearShowTimer();
		const related = event.relatedTarget;
		if (sharedTaskHoverMenu.contains(related)) {
			sharedTaskHoverMenu.clearHideTimer();
			return;
		}
		sharedHoverMenuDelayMs = Math.max(0, options.getSettings().contextualMenuOpenDelayMs);
		sharedTaskHoverMenu.scheduleHide();
	};

	triggerEl.addEventListener('pointerenter', handlePointerEnter);
	triggerEl.addEventListener('pointerleave', handlePointerLeave);

	return () => {
		clearShowTimer();
		triggerEl.removeEventListener('pointerenter', handlePointerEnter);
		triggerEl.removeEventListener('pointerleave', handlePointerLeave);
		if (sharedTaskHoverMenu.isActive(menuKey)) {
			sharedTaskHoverMenu.hide(true);
		}
	};
}
