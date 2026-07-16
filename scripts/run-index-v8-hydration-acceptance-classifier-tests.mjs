import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const contract = 'operon-index-v8-hydration-acceptance-classifier-test-v1';
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-index-v8-hydration-acceptance-classifier-test-'));

try {
	const outfile = path.join(tempDir, 'classifier.test.mjs');
	await build({
		entryPoints: [path.join(rootDir, 'scripts/index-v8-hydration-acceptance-classifier.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	process.stdout.write(`${JSON.stringify({ ok: true, contract, assertions: 12 })}\n`);
} catch (error) {
	process.stdout.write(`${JSON.stringify({
		ok: false,
		contract,
		error: { code: sanitizeError(error) },
	})}\n`);
	process.exitCode = 1;
} finally {
	await rm(tempDir, { recursive: true, force: true });
}

function sanitizeError(error) {
	const raw = error instanceof Error ? error.message : String(error);
	return raw.replace(/[^A-Za-z0-9_.-]+/gu, '-').slice(0, 120) || 'unknown';
}
