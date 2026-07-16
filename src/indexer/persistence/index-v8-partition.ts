import {
	INDEX_V8_PARTITION_ALGORITHM,
	INDEX_V8_SHARD_COUNT,
	type IndexV8ShardId,
} from './index-v8-contract';

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:\//;

export class IndexV8PathError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'IndexV8PathError';
	}
}

export function normalizeIndexV8SourcePath(input: string): string {
	if (typeof input !== 'string' || input.length === 0) {
		throw new IndexV8PathError('Source path must be a non-empty string');
	}
	const normalized = input.replace(/\\/g, '/').normalize('NFC');
	if (
		normalized.startsWith('/')
		|| normalized.startsWith('//')
		|| WINDOWS_DRIVE_PATH.test(normalized)
		|| hasControlCharacter(normalized)
	) {
		throw new IndexV8PathError('Source path must be a safe vault-relative path');
	}
	const segments = normalized.split('/');
	if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
		throw new IndexV8PathError('Source path contains an unsafe segment');
	}
	return normalized;
}

function hasControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
}

export function fnv1a32Utf8Nfc(input: string): number {
	const bytes = new TextEncoder().encode(input.normalize('NFC'));
	let hash = 0x811c9dc5;
	for (const byte of bytes) {
		hash ^= byte;
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

export function getIndexV8ShardId(sourcePath: string): IndexV8ShardId {
	const normalized = normalizeIndexV8SourcePath(sourcePath);
	const shard = fnv1a32Utf8Nfc(normalized) & (INDEX_V8_SHARD_COUNT - 1);
	return shard.toString(16).padStart(2, '0');
}

export function getAllIndexV8ShardIds(): IndexV8ShardId[] {
	return Array.from(
		{ length: INDEX_V8_SHARD_COUNT },
		(_unused, index) => index.toString(16).padStart(2, '0'),
	);
}

export function isIndexV8PartitionAlgorithm(value: unknown): value is typeof INDEX_V8_PARTITION_ALGORITHM {
	return value === INDEX_V8_PARTITION_ALGORITHM;
}
