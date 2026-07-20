export function obsidianRequestUrlTestPlugin() {
	return {
		name: 'obsidian-request-url-test-stub',
		setup(build) {
			build.onResolve({ filter: /^obsidian$/ }, () => ({
				path: 'obsidian',
				namespace: 'operon-test',
			}));
			build.onLoad({ filter: /.*/, namespace: 'operon-test' }, () => ({
				contents: `export async function requestUrl() {
	throw new Error('Unexpected Obsidian requestUrl call in package-manager test');
}
`,
				loader: 'js',
			}));
		},
	};
}
