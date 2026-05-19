import { App, WorkspaceLeaf } from 'obsidian';
import { normalizeTagValue } from './field-pickers/tag-picker';

export async function openObsidianTagSearch(app: App, rawTag: string): Promise<void> {
	const normalized = normalizeTagValue(rawTag);
	if (!normalized) return;

	const query = `tag:#${normalized}`;
	const existingLeaf = app.workspace.getLeavesOfType('search')[0];
	const leaf = existingLeaf ?? app.workspace.getRightLeaf(false);
	if (!leaf) return;

	await leaf.setViewState({
		type: 'search',
		state: { query },
		active: true,
	});

	await app.workspace.revealLeaf(leaf);
	app.workspace.setActiveLeaf(leaf, { focus: true });
	applyQueryToSearchLeaf(leaf, query);
}

function applyQueryToSearchLeaf(leaf: WorkspaceLeaf, query: string): void {
	const view = leaf.view as {
		setQuery?: (value: string) => void;
		searchComponent?: { setValue?: (value: string) => void; onChanged?: () => void };
	} | null;
	if (!view) return;

	if (typeof view.setQuery === 'function') {
		view.setQuery(query);
		return;
	}

	if (view.searchComponent?.setValue) {
		view.searchComponent.setValue(query);
		view.searchComponent.onChanged?.();
	}
}
