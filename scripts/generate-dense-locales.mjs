import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DENSE_LOCALE_SCHEMA_VERSION = 1;
export const LOCALE_DEFINITIONS = Object.freeze([
	{ code: 'en', file: 'en.json' },
	{ code: 'tr', file: 'tr.json' },
	{ code: 'de', file: 'de.json' },
	{ code: 'fr', file: 'fr.json' },
	{ code: 'es', file: 'es.json' },
	{ code: 'zh-CN', file: 'zh-CN.json' },
	{ code: 'zh-TW', file: 'zh-TW.json' },
	{ code: 'ja', file: 'ja.json' },
	{ code: 'ru', file: 'ru.json' },
]);

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultLocaleDirectory = path.join(scriptRoot, 'i18n/locales');
const defaultArtifactPath = path.join(scriptRoot, 'src/generated/dense-locales.json');
const placeholderPattern = /\{\{([A-Za-z0-9_]+)\}\}/gu;

export class DenseLocaleError extends Error {
	constructor(message) {
		super(message);
		this.name = 'DenseLocaleError';
	}
}

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readLocaleFile(filePath, code) {
	let text;
	try {
		text = fs.readFileSync(filePath, 'utf8');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new DenseLocaleError(`Could not read ${code} locale: ${message}`);
	}

	try {
		return JSON.parse(text);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new DenseLocaleError(`Could not parse ${code} locale JSON: ${message}`);
	}
}

function flattenLocale(locale, code) {
	if (!isPlainObject(locale)) {
		throw new DenseLocaleError(`${code} locale root must be an object.`);
	}

	const leaves = new Map();
	for (const category of Object.keys(locale).sort(compareText)) {
		const categoryValue = locale[category];
		if (!isPlainObject(categoryValue)) {
			throw new DenseLocaleError(`${code} locale category ${category} must be an object.`);
		}
		for (const key of Object.keys(categoryValue).sort(compareText)) {
			const value = categoryValue[key];
			if (typeof value !== 'string') {
				throw new DenseLocaleError(`${code} locale value ${category}.${key} must be a string.`);
			}
			leaves.set(`${category}\u0000${key}`, { category, key, value });
		}
	}

	if (leaves.size === 0) throw new DenseLocaleError(`${code} locale contains no string values.`);
	return leaves;
}

function extractPlaceholders(value) {
	return [...value.matchAll(placeholderPattern)].map(match => match[1]).sort(compareText);
}

function assertLocaleFileInventory(localeDirectory, definitions) {
	let entries;
	try {
		entries = fs.readdirSync(localeDirectory, { withFileTypes: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new DenseLocaleError(`Could not inspect locale directory: ${message}`);
	}

	const expectedFiles = definitions.map(definition => definition.file).sort(compareText);
	const actualFiles = entries
		.filter(entry => entry.isFile() && entry.name.endsWith('.json'))
		.map(entry => entry.name)
		.sort(compareText);
	const expectedSet = new Set(expectedFiles);
	const actualSet = new Set(actualFiles);
	const missing = expectedFiles.filter(file => !actualSet.has(file));
	const unlisted = actualFiles.filter(file => !expectedSet.has(file));
	if (missing.length > 0 || unlisted.length > 0) {
		throw new DenseLocaleError(
			`Locale file inventory mismatch: missing=[${missing.join(',') || 'none'}] `
			+ `unlisted=[${unlisted.join(',') || 'none'}].`,
		);
	}
}

function assertLocaleParity(englishLeaves, localeLeaves, code) {
	for (const [compoundKey, englishLeaf] of englishLeaves) {
		const localeLeaf = localeLeaves.get(compoundKey);
		if (!localeLeaf) {
			throw new DenseLocaleError(`Missing ${code} locale key: ${englishLeaf.category}.${englishLeaf.key}`);
		}
		const englishPlaceholders = extractPlaceholders(englishLeaf.value);
		const localePlaceholders = extractPlaceholders(localeLeaf.value);
		if (englishPlaceholders.join('\u0000') !== localePlaceholders.join('\u0000')) {
			throw new DenseLocaleError(
				`Placeholder mismatch for ${code} locale key ${englishLeaf.category}.${englishLeaf.key}: `
				+ `en=[${englishPlaceholders.join(',')}] ${code}=[${localePlaceholders.join(',')}].`,
			);
		}
	}

	for (const [compoundKey, localeLeaf] of localeLeaves) {
		if (!englishLeaves.has(compoundKey)) {
			throw new DenseLocaleError(`Extra ${code} locale key: ${localeLeaf.category}.${localeLeaf.key}`);
		}
	}
}

export function buildDenseLocalePack(options = {}) {
	const localeDirectory = path.resolve(options.localeDirectory ?? defaultLocaleDirectory);
	const definitions = options.localeDefinitions ?? LOCALE_DEFINITIONS;
	if (!Array.isArray(definitions) || definitions.length === 0 || definitions[0]?.code !== 'en') {
		throw new DenseLocaleError('Locale definitions must begin with English.');
	}

	const localeCodes = new Set();
	const localeFiles = new Set();
	for (const definition of definitions) {
		if (!definition || typeof definition.code !== 'string' || typeof definition.file !== 'string') {
			throw new DenseLocaleError('Every locale definition must provide string code and file values.');
		}
		if (localeCodes.has(definition.code)) throw new DenseLocaleError(`Duplicate locale code: ${definition.code}`);
		if (localeFiles.has(definition.file)) throw new DenseLocaleError(`Duplicate locale file: ${definition.file}`);
		if (definition.file !== `${definition.code}.json`) {
			throw new DenseLocaleError(`Locale ${definition.code} must use file ${definition.code}.json, received ${definition.file}.`);
		}
		localeCodes.add(definition.code);
		localeFiles.add(definition.file);
	}
	assertLocaleFileInventory(localeDirectory, definitions);

	const locales = new Map();
	for (const definition of definitions) {
		locales.set(
			definition.code,
			flattenLocale(readLocaleFile(path.join(localeDirectory, definition.file), definition.code), definition.code),
		);
	}

	const englishLeaves = locales.get('en');
	if (!englishLeaves) throw new DenseLocaleError('English locale is required.');
	for (const [code, leaves] of locales) {
		if (code !== 'en') assertLocaleParity(englishLeaves, leaves, code);
	}

	const orderedEnglishLeaves = [...englishLeaves.values()].sort((left, right) => (
		compareText(left.category, right.category) || compareText(left.key, right.key)
	));
	const keyIndex = {};
	orderedEnglishLeaves.forEach((leaf, index) => {
		if (!keyIndex[leaf.category]) keyIndex[leaf.category] = {};
		keyIndex[leaf.category][leaf.key] = index;
	});

	const packedLocales = {};
	for (const definition of definitions) {
		const localeLeaves = locales.get(definition.code);
		packedLocales[definition.code] = orderedEnglishLeaves.map(englishLeaf => (
			localeLeaves.get(`${englishLeaf.category}\u0000${englishLeaf.key}`).value
		));
	}

	return {
		schemaVersion: DENSE_LOCALE_SCHEMA_VERSION,
		languageOrder: definitions.map(definition => definition.code),
		keyCount: orderedEnglishLeaves.length,
		keyIndex,
		locales: packedLocales,
	};
}

export function serializeDenseLocalePack(pack) {
	return `${JSON.stringify(pack, null, 2)}\n`;
}

export function createDenseLocaleArtifact(options = {}) {
	return serializeDenseLocalePack(buildDenseLocalePack(options));
}

export function writeFileAtomically(filePath, contents, fileSystem = fs) {
	const tempPath = path.join(
		path.dirname(filePath),
		`.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
	);
	let fileDescriptor;
	try {
		fileDescriptor = fileSystem.openSync(tempPath, 'wx');
		fileSystem.writeFileSync(fileDescriptor, contents, 'utf8');
		fileSystem.closeSync(fileDescriptor);
		fileDescriptor = undefined;
		fileSystem.renameSync(tempPath, filePath);
	} catch (error) {
		if (fileDescriptor !== undefined) {
			try {
				fileSystem.closeSync(fileDescriptor);
			} catch {
				// Preserve the original write failure.
			}
		}
		try {
			fileSystem.unlinkSync(tempPath);
		} catch (cleanupError) {
			if (!cleanupError || typeof cleanupError !== 'object' || !('code' in cleanupError) || cleanupError.code !== 'ENOENT') {
				throw cleanupError;
			}
		}
		throw error;
	}
}

export function writeDenseLocaleArtifact(options = {}) {
	const artifactPath = path.resolve(options.artifactPath ?? defaultArtifactPath);
	const output = createDenseLocaleArtifact(options);
	fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
	writeFileAtomically(artifactPath, output, options.fileSystem ?? fs);
	return { artifactPath, output, pack: JSON.parse(output) };
}

export function checkDenseLocaleArtifact(options = {}) {
	const artifactPath = path.resolve(options.artifactPath ?? defaultArtifactPath);
	const expected = createDenseLocaleArtifact(options);
	let actual;
	try {
		actual = fs.readFileSync(artifactPath, 'utf8');
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
			throw new DenseLocaleError(`Dense locale artifact is missing: ${artifactPath}. Run npm run i18n:dense:generate.`);
		}
		const message = error instanceof Error ? error.message : String(error);
		throw new DenseLocaleError(`Could not read dense locale artifact: ${message}`);
	}
	if (actual !== expected) {
		throw new DenseLocaleError('Dense locale artifact is stale. Run npm run i18n:dense:generate and review the generated diff.');
	}
	return { artifactPath, output: actual, pack: JSON.parse(actual) };
}

export function runDenseLocaleGenerator(args = [], options = {}) {
	const logger = options.logger ?? console;
	try {
		if (args.length !== 1 || (args[0] !== '--write' && args[0] !== '--check')) {
			throw new DenseLocaleError('Usage: generate-dense-locales.mjs --write|--check');
		}
		const result = args[0] === '--write'
			? writeDenseLocaleArtifact(options)
			: checkDenseLocaleArtifact(options);
		const action = args[0] === '--write' ? 'generated' : 'passed freshness check';
		logger.log(
			`Operon dense locale artifact ${action}: ${result.pack.keyCount.toLocaleString('en-US')} keys × `
			+ `${result.pack.languageOrder.length} languages.`,
		);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error(`Operon dense locale generation failed: ${message}`);
		return 1;
	}
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedUrl) {
	process.exitCode = runDenseLocaleGenerator(process.argv.slice(2));
}
