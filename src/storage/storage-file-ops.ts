import type { DataAdapter } from 'obsidian';

type StorageAdapter = Pick<DataAdapter, 'exists' | 'read' | 'write' | 'remove'>
	& Partial<Pick<DataAdapter, 'process' | 'rename'>>;

export interface RecoveredStoreWriteOptions {
	forceRecoveredWrite?: boolean;
}

function buildTempPath(path: string): string {
	return `${path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildInvalidJsonBackupPath(path: string, timestamp = Date.now()): string {
	return `${path}.invalid-${timestamp}.bak`;
}

export async function writeTextSafely(
	adapter: StorageAdapter,
	path: string,
	data: string,
): Promise<void> {
	if (typeof adapter.process === 'function' && await adapter.exists(path)) {
		await adapter.process(path, () => data);
		return;
	}

	if (typeof adapter.rename !== 'function') {
		await adapter.write(path, data);
		return;
	}

	const tempPath = buildTempPath(path);
	let tempWritten = false;
	try {
		await adapter.write(tempPath, data);
		tempWritten = true;
		if (await adapter.exists(path)) {
			await adapter.remove(path);
		}
		await adapter.rename(tempPath, path);
	} catch (error) {
		if (tempWritten) {
			try {
				if (await adapter.exists(tempPath)) {
					await adapter.remove(tempPath);
				}
			} catch {
				// Best-effort cleanup only; preserve the original write error.
			}
		}
		throw error;
	}
}

export async function writeJsonSafely(
	adapter: StorageAdapter,
	path: string,
	data: unknown,
): Promise<string> {
	const json = JSON.stringify(data, null, '\t');
	await writeTextSafely(adapter, path, json);
	return json;
}

export async function preserveInvalidJsonFile(
	adapter: StorageAdapter,
	path: string,
	raw: string,
): Promise<string> {
	const backupPath = buildInvalidJsonBackupPath(path);
	await writeTextSafely(adapter, backupPath, raw);
	return backupPath;
}

export function shouldSkipStoreWrite(
	isSameSerialized: boolean,
	fileExists: boolean,
	recoveredFromMalformed: boolean,
	options: RecoveredStoreWriteOptions = {},
): boolean {
	if (!fileExists) return false;
	if (recoveredFromMalformed) return options.forceRecoveredWrite !== true;
	return isSameSerialized;
}
