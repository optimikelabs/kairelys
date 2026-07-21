import assert from 'node:assert/strict';
import test from 'node:test';

import {
	filterTasksToFolderTree,
	parseEmbeddedFilterReference,
	resolveEmbeddedFilterSourceFolder,
} from '../src/core/embed-filter-scope.ts';

test('parses a saved filter with a current-folder scope', () => {
	assert.deepEqual(
		parseEmbeddedFilterReference('filterId: "fs_project_open"\nscope: "current-folder"'),
		{
			filterId: 'fs_project_open',
			filterName: null,
			scope: 'current-folder',
		},
	);
});

test('keeps existing embeds vault-scoped by default', () => {
	assert.deepEqual(
		parseEmbeddedFilterReference('filter: "Open tasks"'),
		{
			filterId: null,
			filterName: 'Open tasks',
			scope: 'vault',
		},
	);
});

test('rejects unsupported scopes and references without a filter', () => {
	assert.equal(parseEmbeddedFilterReference('filterId: fs_open\nscope: current-note'), null);
	assert.equal(parseEmbeddedFilterReference('scope: current-folder'), null);
});

test('resolves the source folder without treating a root note as a folder scope', () => {
	assert.equal(
		resolveEmbeddedFilterSourceFolder('Efforts/Projets/Élysia/Projet.md'),
		'Efforts/Projets/Élysia',
	);
	assert.equal(
		resolveEmbeddedFilterSourceFolder('Efforts\\Projets\\Élysia\\Projet.md'),
		'Efforts/Projets/Élysia',
	);
	assert.equal(resolveEmbeddedFilterSourceFolder('Projet.md'), null);
});

test('limits tasks to the current folder tree without matching sibling prefixes', () => {
	const tasks = [
		mockTask('same', 'Efforts/Projets/Élysia/Projet.md'),
		mockTask('child', 'Efforts/Projets/Élysia/Satellite/Note.md'),
		mockTask('case', 'efforts/projets/élysia/Autre.md'),
		mockTask('sibling-prefix', 'Efforts/Projets/Élysia 2/Projet.md'),
		mockTask('outside', 'Efforts/Créations/Note.md'),
	];

	assert.deepEqual(
		filterTasksToFolderTree(tasks, 'Efforts/Projets/Élysia').map(task => task.operonId),
		['same', 'child', 'case'],
	);
});

function mockTask(operonId: string, filePath: string) {
	return {
		operonId,
		description: operonId,
		checkbox: 'open' as const,
		fieldValues: {},
		tags: [],
		primary: { filePath, lineNumber: 1, format: 'inline' as const },
		datetimeModified: '2026-07-21T00:00:00.000Z',
		tier: 'hot' as const,
	};
}
