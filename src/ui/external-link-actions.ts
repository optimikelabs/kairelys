import { App, Menu, Notice, Platform } from 'obsidian';
import { t } from '../core/i18n';
import { getInternalPlugin, isPluginEnabled } from '../core/obsidian-app';

interface WebViewerPlugin {
	openUrl: (url: string, pane: 'tab', active: boolean) => void;
}

interface InternalPluginsWithWebViewer {
	getEnabledPluginById?: (id: string) => unknown;
}

/**
 * Opens a URL in the enabled Obsidian Web Viewer core plugin.
 *
 * Web Viewer's plugin identity and openUrl method are private Obsidian APIs.
 * Keep that compatibility seam here and make callers handle an unavailable
 * viewer instead of silently falling through to a browser window.
 */
export function openWebViewerNewTab(app: App, url: string | null | undefined): boolean {
	const normalized = (url ?? '').trim();
	if (!normalized || !Platform.isDesktopApp) return false;
	const internalPlugins = (app as unknown as {
		internalPlugins?: InternalPluginsWithWebViewer;
	}).internalPlugins;
	const enabledPlugin = internalPlugins?.getEnabledPluginById?.('webviewer');
	const plugin = isWebViewerPlugin(enabledPlugin)
		? enabledPlugin
		: getEnabledWebViewerPlugin(app);
	if (!isWebViewerPlugin(plugin)) return false;
	try {
		plugin.openUrl(normalized, 'tab', true);
		return true;
	} catch (error) {
		console.warn('Operon: failed to open URL in Obsidian Web Viewer', error);
		return false;
	}
}

function getEnabledWebViewerPlugin(app: App): WebViewerPlugin | null {
	const plugin = getInternalPlugin(app, 'webviewer');
	return isPluginEnabled(plugin) && isWebViewerPlugin(plugin) ? plugin : null;
}

export function openExternalUrl(url: string | null | undefined): void {
	const normalized = (url ?? '').trim();
	if (!normalized) return;
	window.open(normalized, '_blank', 'noopener');
}

function isWebViewerPlugin(value: unknown): value is WebViewerPlugin {
	return typeof value === 'object'
		&& value !== null
		&& typeof (value as WebViewerPlugin).openUrl === 'function';
}

export function bindExternalLinkContextMenu(
	element: HTMLElement,
	url: string | null | undefined,
	rawValue: string | null | undefined,
): void {
	const normalizedUrl = (url ?? '').trim();
	if (!normalizedUrl) return;
	const normalizedRaw = (rawValue ?? '').trim();
	element.addEventListener('contextmenu', event => {
		event.preventDefault();
		event.stopPropagation();
		const menu = new Menu();
		menu.addItem(item => item
			.setTitle(t('taskEditor', 'copyUrl'))
			.setIcon('copy')
			.onClick(() => {
				void copyToClipboard(normalizedUrl, t('notifications', 'linkCopied'));
			}));
		if (normalizedRaw && normalizedRaw !== normalizedUrl) {
			menu.addItem(item => item
				.setTitle(t('taskEditor', 'copyMarkdownLink'))
				.setIcon('clipboard-copy')
				.onClick(() => {
					void copyToClipboard(normalizedRaw, t('notifications', 'markdownLinkCopied'));
				}));
		}
		menu.showAtMouseEvent(event);
	});
}

async function copyToClipboard(text: string, successMessage: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		new Notice(successMessage);
	} catch {
		new Notice(t('notifications', 'clipboardWriteFailed'));
	}
}
