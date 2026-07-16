import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let tempDir = null;

try {
	tempDir = await mkdtemp(path.join(tmpdir(), 'operon-index-baseline-'));
	const outfile = path.join(tempDir, 'index-baseline.mjs');
	await build({
		entryPoints: [path.join(rootDir, 'scripts/index-baseline.ts')],
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
	const benchmarkModule = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	if (typeof benchmarkModule.runIndexBaseline !== 'function') {
		throw new Error('Index baseline runner did not expose its completion promise.');
	}
	const keepAlive = setInterval(() => {}, 1_000);
	try {
		const report = await benchmarkModule.runIndexBaseline();
		await writeStdout(`${JSON.stringify(report)}\n`);
		process.exitCode = report.ok === true ? 0 : 1;
	} finally {
		clearInterval(keepAlive);
	}
} catch (error) {
	await writeStdout(`${JSON.stringify({
		ok: false,
		contract: 'operon-index-v8-baseline-v3',
		error: { code: sanitizeError(error) },
	})}\n`);
	process.exitCode = 1;
} finally {
	if (tempDir !== null) {
		try {
			await rm(tempDir, { recursive: true, force: true });
		} catch {
			// Benchmark cleanup is best-effort and must not replace the JSON result.
		}
	}
}

async function writeStdout(value) {
	await new Promise((resolveWrite, rejectWrite) => {
		process.stdout.write(value, error => {
			if (error) rejectWrite(error);
			else resolveWrite();
		});
	});
}

function sanitizeError(error) {
	const raw = error instanceof Error ? error.message : String(error);
	return raw.replace(/[^A-Za-z0-9_.-]+/gu, '-').slice(0, 120) || 'unknown';
}
