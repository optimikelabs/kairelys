import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ACCEPTANCE_CONTRACT = 'operon-index-v8-hydration-acceptance-v1';
const CHILD_CONTRACT = 'operon-index-v8-hydration-acceptance-run-v1';
const CHILD_COUNT = 2;
const CHILD_TIMEOUT_MS = 300_000;
const MAX_CHILD_OUTPUT_BYTES = 2_000_000;
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let tempDir = null;

try {
	tempDir = await mkdtemp(path.join(tmpdir(), 'operon-index-v8-hydration-acceptance-runner-'));
	const workerFile = path.join(tempDir, 'worker.mjs');
	const classifierFile = path.join(tempDir, 'classifier.mjs');
	await Promise.all([
		bundle(path.join(rootDir, 'scripts/index-v8-hydration-acceptance-worker.ts'), workerFile),
		bundle(path.join(rootDir, 'scripts/index-v8-hydration-acceptance-classifier.ts'), classifierFile),
	]);
	const classifier = await import(`${pathToFileURL(classifierFile).href}?t=${Date.now()}`);
	const attempts = [];
	let attempt = await runSet(workerFile, classifier);
	attempts.push(attempt);
	if (shouldRetry(attempt)) {
		attempt = await runSet(workerFile, classifier);
		attempts.push(attempt);
	}
	const { childResults, runs, classification, status } = attempt;
	const output = {
		ok: status === 'pass',
		contract: ACCEPTANCE_CONTRACT,
		status,
		stable: status === classification.status && classification.stable,
		threshold: classifier.HYDRATION_ACCEPTANCE_THRESHOLD,
		childProcesses: CHILD_COUNT * attempts.length,
		setsAttempted: attempts.length,
		freshTempPerChild: true,
		diskContract: 'warm-page-cache-startup',
		warmupPairs: 10,
		pairedSamples: classifier.HYDRATION_ACCEPTANCE_PAIRED_SAMPLES,
		order: 'alternating-ab-ba',
		heapSamples: classifier.HYDRATION_ACCEPTANCE_HEAP_SAMPLES,
		classification,
		attempts: attempts.map(result => ({
			status: result.status,
			classification: result.classification,
			childFailures: result.childResults.flatMap((child, index) => (
				child.ok ? [] : [{ child: index + 1, code: child.code }]
			)),
			runs: result.runs,
		})),
		childFailures: childResults.flatMap((result, index) => (
			result.ok ? [] : [{ child: index + 1, code: result.code }]
		)),
		runs,
	};
	await writeStdout(`${JSON.stringify(output)}\n`);
	process.exitCode = status === 'pass' ? 0 : status === 'fail' ? 1 : 2;
} catch (error) {
	await writeStdout(`${JSON.stringify({
		ok: false,
		contract: ACCEPTANCE_CONTRACT,
		status: 'inconclusive',
		stable: false,
		error: { code: sanitizeError(error) },
	})}\n`);
	process.exitCode = 2;
} finally {
	if (tempDir !== null) {
		try {
			await rm(tempDir, { recursive: true, force: true });
		} catch {
			// Benchmark cleanup is best-effort and must not replace the JSON result.
		}
	}
}

async function runSet(workerFile, classifier) {
	const childResults = [];
	for (let index = 0; index < CHILD_COUNT; index++) {
		childResults.push(await runChild(workerFile));
	}
	const runs = childResults.flatMap(result => result.ok ? [result.run] : []);
	const classification = classifier.classifyAcceptance(runs);
	const status = childResults.every(result => result.ok)
		? classification.status
		: 'inconclusive';
	return { childResults, runs, classification, status };
}

function shouldRetry(attempt) {
	if (attempt.status !== 'inconclusive') return false;
	if (attempt.childResults.some(result => (
		!result.ok && (result.code === 'child-timeout' || result.code.startsWith('spawn-'))
	))) return true;
	if (attempt.childResults.some(result => !result.ok)) return false;
	if (attempt.classification.reasons.includes('mixed-gate-results')) return true;
	const retryableReasons = new Set([
		'v7-order-bias',
		'v8-order-bias',
		'paired-order-ratio-bias',
		'timing-tail-unstable',
		'heap-tail-unstable',
	]);
	return attempt.classification.runs.some(run => (
		run.stability === 'inconclusive'
		&& run.reasons.length > 0
		&& run.reasons.every(reason => retryableReasons.has(reason))
	));
}

async function bundle(entryPoint, outfile) {
	await build({
		entryPoints: [entryPoint],
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
}

async function runChild(workerFile) {
	return await new Promise(resolve => {
		const child = spawn(process.execPath, ['--expose-gc', workerFile], {
			cwd: rootDir,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderrBytes = 0;
		let outputOverflow = false;
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			child.kill('SIGKILL');
		}, CHILD_TIMEOUT_MS);
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', chunk => {
			if (Buffer.byteLength(stdout) + Buffer.byteLength(chunk) > MAX_CHILD_OUTPUT_BYTES) {
				outputOverflow = true;
				child.kill('SIGKILL');
				return;
			}
			stdout += chunk;
		});
		child.stderr.on('data', chunk => {
			stderrBytes += chunk.length;
		});
		child.on('error', error => {
			clearTimeout(timeout);
			resolve({ ok: false, code: `spawn-${sanitizeError(error)}` });
		});
		child.on('close', code => {
			clearTimeout(timeout);
			if (timedOut) return resolve({ ok: false, code: 'child-timeout' });
			if (outputOverflow) return resolve({ ok: false, code: 'child-output-limit' });
			const parsed = parseChildOutput(stdout);
			if (!parsed.ok) return resolve(parsed);
			if (code !== 0) return resolve({ ok: false, code: `child-exit-${code ?? 'signal'}` });
			if (stderrBytes > 0) return resolve({ ok: false, code: 'child-stderr-output' });
			resolve(parsed);
		});
	});
}

function parseChildOutput(stdout) {
	const lines = stdout.split(/\r?\n/u).filter(line => line.trim().length > 0);
	if (lines.length !== 1) return { ok: false, code: 'child-json-line-count' };
	let value;
	try {
		value = JSON.parse(lines[0]);
	} catch {
		return { ok: false, code: 'child-json-invalid' };
	}
	if (!value || value.contract !== CHILD_CONTRACT) return { ok: false, code: 'child-contract-invalid' };
	if (value.error) return { ok: false, code: 'child-reported-error' };
	return { ok: true, run: value };
}

function sanitizeError(error) {
	const raw = error instanceof Error ? error.message : String(error);
	return raw.replace(/[^A-Za-z0-9_.-]+/gu, '-').slice(0, 120) || 'unknown';
}

async function writeStdout(value) {
	await new Promise((resolveWrite, rejectWrite) => {
		process.stdout.write(value, error => {
			if (error) rejectWrite(error);
			else resolveWrite();
		});
	});
}
