import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const numberFormatter = new Intl.NumberFormat('en-US');

class LocaleAuditError extends Error {
	constructor(message) {
		super(message);
		this.name = 'LocaleAuditError';
	}
}

function toPosixPath(filePath) {
	return filePath.split(path.sep).join('/');
}

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique(values) {
	return [...new Set(values)].sort(compareText);
}

function flattenStringLeaves(value, prefix = '') {
	const leaves = [];
	if (typeof value === 'string') {
		leaves.push(prefix);
		return leaves;
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) return leaves;

	for (const [key, child] of Object.entries(value)) {
		const nextPrefix = prefix ? `${prefix}.${key}` : key;
		leaves.push(...flattenStringLeaves(child, nextPrefix));
	}
	return leaves;
}

function collectTypeScriptFiles(directory) {
	const files = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))) {
		const filePath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectTypeScriptFiles(filePath));
		} else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
			files.push(filePath);
		}
	}
	return files;
}

function discoverProductionSources(rootDir) {
	const mainPath = path.join(rootDir, 'main.ts');
	const srcPath = path.join(rootDir, 'src');
	if (!fs.existsSync(mainPath)) throw new LocaleAuditError('Missing production source: main.ts');
	if (!fs.existsSync(srcPath)) throw new LocaleAuditError('Missing production source directory: src');
	return [mainPath, ...collectTypeScriptFiles(srcPath)];
}

function readEnglishLocale(englishLocalePath) {
	let locale;
	try {
		locale = JSON.parse(fs.readFileSync(englishLocalePath, 'utf8'));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new LocaleAuditError(`Could not read English locale: ${message}`);
	}

	const keys = sortedUnique(flattenStringLeaves(locale).filter(Boolean));
	if (keys.length === 0) throw new LocaleAuditError('English locale contains no string keys.');
	return keys;
}

function withoutModuleExtension(filePath) {
	return filePath.replace(/\.(?:[cm]?[jt]sx?)$/u, '');
}

function isI18nModuleSpecifier(value, sourceFile, rootDir) {
	let resolvedPath;
	if (value.startsWith('.')) {
		resolvedPath = path.resolve(path.dirname(sourceFile.fileName), value);
	} else if (value === 'core/i18n') {
		resolvedPath = path.resolve(rootDir, 'src', value);
	} else if (value.startsWith('src/')) {
		resolvedPath = path.resolve(rootDir, value);
	} else if (path.isAbsolute(value)) {
		resolvedPath = path.resolve(value);
	} else {
		return false;
	}

	const expectedPath = path.resolve(rootDir, 'src/core/i18n');
	return withoutModuleExtension(resolvedPath) === expectedPath;
}

function findI18nBindings(sourceFile, checker, rootDir) {
	const bindings = new Map();
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
		if (!isI18nModuleSpecifier(statement.moduleSpecifier.text, sourceFile, rootDir)) continue;
		const namedBindings = statement.importClause?.namedBindings;
		if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;

		for (const element of namedBindings.elements) {
			const importedName = element.propertyName?.text ?? element.name.text;
			if (importedName !== 't' && importedName !== 'getTranslations') continue;
			const symbol = checker.getSymbolAtLocation(element.name);
			if (symbol) bindings.set(symbol, importedName);
		}
	}
	return bindings;
}

function unwrapExpression(expression) {
	let current = expression;
	while (
		ts.isParenthesizedExpression(current)
		|| ts.isAsExpression(current)
		|| ts.isTypeAssertionExpression(current)
		|| ts.isNonNullExpression(current)
		|| (typeof ts.isSatisfiesExpression === 'function' && ts.isSatisfiesExpression(current))
	) {
		current = current.expression;
	}
	return current;
}

export function resolveStaticStrings(expression) {
	if (!expression) return null;
	const current = unwrapExpression(expression);
	if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
		return [current.text];
	}
	if (ts.isConditionalExpression(current)) {
		const whenTrue = resolveStaticStrings(current.whenTrue);
		const whenFalse = resolveStaticStrings(current.whenFalse);
		if (!whenTrue || !whenFalse) return null;
		return sortedUnique([...whenTrue, ...whenFalse]);
	}
	return null;
}

function createSourceProgram(sourcePaths) {
	const program = ts.createProgram({
		rootNames: sourcePaths,
		options: {
			noLib: true,
			noResolve: true,
			skipLibCheck: true,
			target: ts.ScriptTarget.Latest,
		},
	});
	for (const filePath of sourcePaths) {
		const sourceFile = program.getSourceFile(filePath);
		if (!sourceFile) throw new LocaleAuditError(`Could not read source ${filePath}.`);
		const diagnostic = program.getSyntacticDiagnostics(sourceFile)[0];
		if (!diagnostic) continue;
		const position = diagnostic.start === undefined
			? { line: 0, character: 0 }
			: sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
		const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
		throw new LocaleAuditError(`${filePath}:${position.line + 1}:${position.character + 1}: ${message}`);
	}
	return program;
}

function expressionPreview(expression, sourceFile) {
	if (!expression) return '<missing>';
	return expression.getText(sourceFile).replace(/\s+/gu, ' ').slice(0, 160);
}

function countByCategory(keys) {
	const counts = new Map();
	for (const key of keys) {
		const separator = key.indexOf('.');
		const category = separator === -1 ? key : key.slice(0, separator);
		counts.set(category, (counts.get(category) ?? 0) + 1);
	}
	return Object.fromEntries([...counts.entries()].sort(([left], [right]) => compareText(left, right)));
}

function compareCallsites(left, right) {
	return compareText(left.file, right.file)
		|| left.line - right.line
		|| left.column - right.column
		|| compareText(left.callee, right.callee);
}

export function analyzeLocaleUsage(options = {}) {
	const rootDir = path.resolve(options.rootDir ?? scriptRoot);
	const englishLocalePath = path.resolve(options.englishLocalePath ?? path.join(rootDir, 'i18n/locales/en.json'));
	const sourcePaths = (options.sourcePaths ?? discoverProductionSources(rootDir)).map(filePath => path.resolve(filePath));
	const localeKeys = readEnglishLocale(englishLocalePath);
	const localeKeySet = new Set(localeKeys);
	const referencedPairs = new Set();
	const unresolvedDynamicCallsites = [];
	let callCount = 0;
	const program = createSourceProgram(sourcePaths);
	const checker = program.getTypeChecker();

	for (const filePath of [...sourcePaths].sort(compareText)) {
		const sourceFile = program.getSourceFile(filePath);
		if (!sourceFile) throw new LocaleAuditError(`Could not read source ${filePath}.`);
		const bindings = findI18nBindings(sourceFile, checker, rootDir);
		if (bindings.size === 0) continue;
		const relativePath = toPosixPath(path.relative(rootDir, filePath));

		function visit(node) {
			if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
				const symbol = checker.getSymbolAtLocation(node.expression);
				const importedName = symbol ? bindings.get(symbol) : undefined;
				if (importedName) {
					callCount += 1;
					const categoryValues = resolveStaticStrings(node.arguments[0]);
					const keyValues = resolveStaticStrings(node.arguments[1]);
					if (categoryValues && keyValues) {
						for (const category of categoryValues) {
							for (const key of keyValues) referencedPairs.add(`${category}.${key}`);
						}
					} else {
						const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
						unresolvedDynamicCallsites.push({
							file: relativePath,
							line: position.line + 1,
							column: position.character + 1,
							callee: importedName,
							reason: !categoryValues && !keyValues
								? 'dynamic category and key'
								: !categoryValues ? 'dynamic category' : 'dynamic key',
							categoryExpression: expressionPreview(node.arguments[0], sourceFile),
							keyExpression: expressionPreview(node.arguments[1], sourceFile),
						});
					}
				}
			}
			ts.forEachChild(node, visit);
		}

		visit(sourceFile);
	}

	const confirmedReferences = [...referencedPairs].filter(key => localeKeySet.has(key)).sort(compareText);
	const referencedMissing = [...referencedPairs].filter(key => !localeKeySet.has(key)).sort(compareText);
	const confirmedSet = new Set(confirmedReferences);
	const candidateUnused = localeKeys.filter(key => !confirmedSet.has(key));
	const sortedCallsites = unresolvedDynamicCallsites.sort(compareCallsites);

	return {
		mode: 'report-only',
		totalLocaleKeys: localeKeys.length,
		sourceFileCount: sourcePaths.length,
		callCount,
		confirmedReferenceCount: confirmedReferences.length,
		candidateUnusedCount: candidateUnused.length,
		referencedMissingCount: referencedMissing.length,
		unresolvedDynamicCallsiteCount: sortedCallsites.length,
		candidateUnusedByCategory: countByCategory(candidateUnused),
		confirmedReferences,
		candidateUnused,
		referencedMissing,
		unresolvedDynamicCallsites: sortedCallsites,
	};
}

function formatCount(value) {
	return numberFormatter.format(value);
}

export function formatLocaleUsageSummary(report) {
	const categories = Object.entries(report.candidateUnusedByCategory)
		.map(([category, count]) => `${category}=${formatCount(count)}`)
		.join(', ');
	return [
		`Operon locale usage audit (report-only): ${formatCount(report.totalLocaleKeys)} locale keys; ${formatCount(report.confirmedReferenceCount)} confirmed references; ${formatCount(report.candidateUnusedCount)} candidate unused; ${formatCount(report.referencedMissingCount)} referenced missing; ${formatCount(report.unresolvedDynamicCallsiteCount)} unresolved dynamic callsites.`,
		`Candidate unused by category: ${categories || 'none'}.`,
		'Findings are informational; no locale keys were removed and validation remains non-enforcing.',
	].join('\n');
}

export function formatLocaleUsageDetails(report) {
	const sections = [formatLocaleUsageSummary(report)];
	sections.push(`\nConfirmed references (${formatCount(report.confirmedReferenceCount)}):`);
	sections.push(report.confirmedReferences.length > 0 ? report.confirmedReferences.join('\n') : 'none');
	sections.push(`\nCandidate unused (${formatCount(report.candidateUnusedCount)}):`);
	sections.push(report.candidateUnused.length > 0 ? report.candidateUnused.join('\n') : 'none');
	sections.push(`\nReferenced missing (${formatCount(report.referencedMissingCount)}):`);
	sections.push(report.referencedMissing.length > 0 ? report.referencedMissing.join('\n') : 'none');
	sections.push(`\nUnresolved dynamic callsites (${formatCount(report.unresolvedDynamicCallsiteCount)}):`);
	sections.push(report.unresolvedDynamicCallsites.length > 0
		? report.unresolvedDynamicCallsites.map(callsite => (
			`${callsite.file}:${callsite.line}:${callsite.column} ${callsite.callee}(${callsite.categoryExpression}, ${callsite.keyExpression}) [${callsite.reason}]`
		)).join('\n')
		: 'none');
	return sections.join('\n');
}

export function parseLocaleAuditArguments(args) {
	let mode = 'details';
	for (const argument of args) {
		if (argument === '--summary') {
			if (mode !== 'details') throw new LocaleAuditError('Choose only one output mode: --summary or --json.');
			mode = 'summary';
		} else if (argument === '--json') {
			if (mode !== 'details') throw new LocaleAuditError('Choose only one output mode: --summary or --json.');
			mode = 'json';
		} else {
			throw new LocaleAuditError(`Unknown argument: ${argument}`);
		}
	}
	return { mode };
}

export function runLocaleUsageAudit(args = [], options = {}) {
	const logger = options.logger ?? console;
	try {
		const { mode } = parseLocaleAuditArguments(args);
		const report = analyzeLocaleUsage(options);
		if (mode === 'json') logger.log(JSON.stringify(report, null, 2));
		else if (mode === 'summary') logger.log(formatLocaleUsageSummary(report));
		else logger.log(formatLocaleUsageDetails(report));
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error(`Operon locale usage audit failed: ${message}`);
		return 2;
	}
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedUrl) {
	process.exitCode = runLocaleUsageAudit(process.argv.slice(2));
}
