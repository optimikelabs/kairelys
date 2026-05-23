import { Menu, Notice } from 'obsidian';
import { t } from '../core/i18n';

export function openExternalUrl(url: string | null | undefined): void {
	const normalized = (url ?? '').trim();
	if (!normalized) return;
	window.open(normalized, '_blank', 'noopener');
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
