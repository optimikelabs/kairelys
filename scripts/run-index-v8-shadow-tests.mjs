import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-index-v8-shadow-test-'));
const outfile = path.join(tempDir, 'index-v8-shadow.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/index-v8-shadow.test.ts')],
		outfile,
		bundle: true,
		alias: {
			obsidian: path.join(rootDir, 'scripts/test-stubs/obsidian.ts'),
		},
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonIndexV8ShadowTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Index V8 shadow test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonIndexV8ShadowTestRun;
	await rm(tempDir, { recursive: true, force: true });
}
