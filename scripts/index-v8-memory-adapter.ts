import type { DataAdapter, ListedFiles, Stat } from 'obsidian';

export class IndexV8MemoryAdapter {
	readonly files = new Map<string, string>();
	readonly binaryFiles = new Map<string, Uint8Array>();
	readonly mtimes = new Map<string, number>();
	readonly folders = new Set<string>();
	readonly operations: string[] = [];
	failOperation: ((operation: string, path: string) => boolean) | null = null;
	corruptAfterProcess: ((path: string, data: string) => string | null) | null = null;
	corruptAfterRename: ((path: string, data: string) => string | null) | null = null;
	afterRead: ((path: string, data: string) => void) | null = null;
	beforeProcess: ((path: string) => void) | null = null;
	delayMs = 0;

	constructor() {
		this.folders.add('');
	}

	asDataAdapter(): DataAdapter {
		return this as unknown as DataAdapter;
	}

	getName(): string { return 'index-v8-memory'; }

	async exists(path: string): Promise<boolean> {
		await this.before('exists', path);
		return this.files.has(path) || this.binaryFiles.has(path) || this.folders.has(path);
	}

	async stat(path: string): Promise<Stat | null> {
		await this.before('stat', path);
		if (this.files.has(path) || this.binaryFiles.has(path)) {
			const size = this.binaryFiles.get(path)?.byteLength ?? new TextEncoder().encode(this.files.get(path)!).length;
			return { type: 'file', ctime: 0, mtime: this.mtimes.get(path) ?? 0, size };
		}
		if (this.folders.has(path)) return { type: 'folder', ctime: 0, mtime: 0, size: 0 };
		return null;
	}

	async list(path: string): Promise<ListedFiles> {
		await this.before('list', path);
		const prefix = path ? `${path}/` : '';
		const files = [...new Set([...this.files.keys(), ...this.binaryFiles.keys()])]
			.filter(candidate => candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes('/'));
		const folders = [...this.folders].filter(candidate => candidate.startsWith(prefix) && candidate !== path && !candidate.slice(prefix.length).includes('/'));
		return { files, folders };
	}

	async read(path: string): Promise<string> {
		await this.before('read', path);
		const value = this.files.get(path);
		if (value === undefined) throw new Error(`Missing file: ${path}`);
		this.afterRead?.(path, value);
		return value;
	}

	async readBinary(path: string): Promise<ArrayBuffer> {
		await this.before('readBinary', path);
		const binary = this.binaryFiles.get(path);
		if (binary) return binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength) as ArrayBuffer;
		const value = this.files.get(path);
		if (value === undefined) throw new Error(`Missing file: ${path}`);
		return new TextEncoder().encode(value).buffer as ArrayBuffer;
	}

	async write(path: string, data: string): Promise<void> {
		await this.before('write', path);
		this.requireParent(path);
		this.binaryFiles.delete(path);
		this.files.set(path, data);
		this.mtimes.set(path, Date.now());
	}

	async process(path: string, fn: (data: string) => string): Promise<string> {
		await this.before('process', path);
		this.beforeProcess?.(path);
		const current = this.files.get(path);
		if (current === undefined) throw new Error(`Missing file: ${path}`);
		const next = fn(current);
		this.files.set(path, this.corruptAfterProcess?.(path, next) ?? next);
		this.mtimes.set(path, Date.now());
		return next;
	}

	async mkdir(path: string): Promise<void> {
		await this.before('mkdir', path);
		const parent = parentPath(path);
		if (!this.folders.has(parent)) throw new Error(`Missing parent folder: ${parent}`);
		this.folders.add(path);
	}

	async remove(path: string): Promise<void> {
		await this.before('remove', path);
		this.files.delete(path);
		this.binaryFiles.delete(path);
		this.folders.delete(path);
		this.mtimes.delete(path);
	}

	async rename(from: string, to: string): Promise<void> {
		await this.before('rename', `${from}->${to}`);
		const value = this.files.get(from);
		if (value === undefined) throw new Error(`Missing file: ${from}`);
		if (this.files.has(to)) throw new Error(`Target already exists: ${to}`);
		this.requireParent(to);
		this.files.set(to, this.corruptAfterRename?.(to, value) ?? value);
		this.binaryFiles.delete(to);
		this.mtimes.set(to, this.mtimes.get(from) ?? Date.now());
		this.files.delete(from);
		this.mtimes.delete(from);
	}

	async copy(from: string, to: string): Promise<void> {
		await this.before('copy', `${from}->${to}`);
		if (this.files.has(to) || this.binaryFiles.has(to)) throw new Error(`Target already exists: ${to}`);
		this.requireParent(to);
		const text = this.files.get(from);
		const binary = this.binaryFiles.get(from);
		if (text === undefined && binary === undefined) throw new Error(`Missing file: ${from}`);
		if (text !== undefined) this.files.set(to, text);
		if (binary !== undefined) this.binaryFiles.set(to, new Uint8Array(binary));
		this.mtimes.set(to, this.mtimes.get(from) ?? Date.now());
	}

	setFile(path: string, data: string, mtimeMs = 0): void {
		this.binaryFiles.delete(path);
		this.files.set(path, data);
		this.mtimes.set(path, mtimeMs);
	}

	setBinaryFile(path: string, data: Uint8Array, mtimeMs = 0): void {
		this.files.delete(path);
		this.binaryFiles.set(path, new Uint8Array(data));
		this.mtimes.set(path, mtimeMs);
	}

	deleteFile(path: string): void {
		this.files.delete(path);
		this.binaryFiles.delete(path);
		this.mtimes.delete(path);
	}

	private async before(operation: string, path: string): Promise<void> {
		this.operations.push(`${operation}:${path}`);
		if (this.delayMs > 0) await new Promise(resolve => setTimeout(resolve, this.delayMs));
		if (this.failOperation?.(operation, path)) throw new Error(`Injected ${operation} failure: ${path}`);
	}

	private requireParent(path: string): void {
		const parent = parentPath(path);
		if (!this.folders.has(parent)) throw new Error(`Missing parent folder: ${parent}`);
	}
}

function parentPath(path: string): string {
	const index = path.lastIndexOf('/');
	return index < 0 ? '' : path.slice(0, index);
}
