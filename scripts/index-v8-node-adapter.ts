import {
	access,
	copyFile,
	mkdir,
	readFile,
	readdir,
	rename,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import type { DataAdapter, ListedFiles, Stat } from 'obsidian';

export class IndexV8NodeAdapter {
	constructor(private readonly root: string) {}

	asDataAdapter(): DataAdapter {
		return this as unknown as DataAdapter;
	}

	getName(): string { return 'index-v8-node-temp'; }

	async reset(): Promise<void> {
		await rm(this.root, { recursive: true, force: true });
		await mkdir(this.root, { recursive: true });
	}

	async exists(vaultPath: string): Promise<boolean> {
		try {
			await access(this.resolve(vaultPath));
			return true;
		} catch {
			return false;
		}
	}

	async stat(vaultPath: string): Promise<Stat | null> {
		try {
			const value = await stat(this.resolve(vaultPath));
			return {
				type: value.isDirectory() ? 'folder' : 'file',
				ctime: value.ctimeMs,
				mtime: value.mtimeMs,
				size: value.size,
			};
		} catch {
			return null;
		}
	}

	async list(vaultPath: string): Promise<ListedFiles> {
		const entries = await readdir(this.resolve(vaultPath), { withFileTypes: true });
		const prefix = vaultPath ? `${vaultPath}/` : '';
		return {
			files: entries.filter(entry => entry.isFile()).map(entry => `${prefix}${entry.name}`),
			folders: entries.filter(entry => entry.isDirectory()).map(entry => `${prefix}${entry.name}`),
		};
	}

	async read(vaultPath: string): Promise<string> {
		return await readFile(this.resolve(vaultPath), 'utf8');
	}

	async readBinary(vaultPath: string): Promise<ArrayBuffer> {
		const value = await readFile(this.resolve(vaultPath));
		return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
	}

	async write(vaultPath: string, data: string): Promise<void> {
		await writeFile(this.resolve(vaultPath), data, 'utf8');
	}

	async process(vaultPath: string, fn: (data: string) => string): Promise<string> {
		const absolute = this.resolve(vaultPath);
		const next = fn(await readFile(absolute, 'utf8'));
		const temporary = `${absolute}.process-${process.pid}-${Date.now()}`;
		await writeFile(temporary, next, 'utf8');
		await rename(temporary, absolute);
		return next;
	}

	async mkdir(vaultPath: string): Promise<void> {
		await mkdir(this.resolve(vaultPath));
	}

	async remove(vaultPath: string): Promise<void> {
		await rm(this.resolve(vaultPath), { recursive: true, force: true });
	}

	async rename(from: string, to: string): Promise<void> {
		await rename(this.resolve(from), this.resolve(to));
	}

	async copy(from: string, to: string): Promise<void> {
		await copyFile(this.resolve(from), this.resolve(to), fsConstants.COPYFILE_EXCL);
	}

	private resolve(vaultPath: string): string {
		const absolute = path.resolve(this.root, vaultPath);
		const relative = path.relative(this.root, absolute);
		if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path escapes temporary adapter root');
		return absolute;
	}
}
