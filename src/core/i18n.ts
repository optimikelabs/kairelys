/**
 * Internationalization (i18n) module for Operon.
 * Multilingual support: English (default), Turkish, German, French, Spanish,
 * Simplified Chinese, Traditional Chinese, Japanese, and Russian.
 *
 * Spec Section 25:
 * - JSON locale files at i18n/locales/
 * - Only user-facing UI is translated
 * - System internals (field names, YAML keys, paths) stay in English
 * - {{variableName}} placeholder syntax
 * - Language detection from Obsidian's locale setting
 * - Fallback to English if locale not found
 */

import denseLocales from '../generated/dense-locales.json';

/** Supported language codes */
export type LangCode = 'en' | 'tr' | 'de' | 'fr' | 'es' | 'zh-CN' | 'zh-TW' | 'ja' | 'ru';

/**
 * Maps an Obsidian/browser locale string to a supported LangCode.
 * Chinese needs full-string handling because Simplified ('zh', 'zh-CN', 'zh-Hans')
 * and Traditional ('zh-TW', 'zh-Hant', 'zh-HK') must not both collapse to a bare 'zh'.
 * Returns null when no supported locale matches.
 */
function normalizeLocale(rawLocale: string): LangCode | null {
	const lower = rawLocale.trim().toLowerCase();
	if (!lower) return null;

	// Chinese script/region disambiguation (checked before the 2-letter fallback).
	if (lower === 'zh' || lower.startsWith('zh-cn') || lower.startsWith('zh-hans') || lower.startsWith('zh-sg')) {
		return 'zh-CN' in LOCALES ? 'zh-CN' : null;
	}
	if (lower.startsWith('zh-tw') || lower.startsWith('zh-hant') || lower.startsWith('zh-hk') || lower.startsWith('zh-mo')) {
		return 'zh-TW' in LOCALES ? 'zh-TW' : null;
	}

	const short = lower.substring(0, 2);
	return short in LOCALES ? (short as LangCode) : null;
}

/** Structure of a locale file — matches Spec Section 25.4 */
export interface LocaleData {
	commands: Record<string, string>;
	presetFavorites: Record<string, string>;
	contextMenu: Record<string, string>;
	modals: Record<string, string>;
	notifications: Record<string, string>;
	duplicateOperonId: Record<string, string>;
	settings: Record<string, string>;
	buttons: Record<string, string>;
	tooltips: Record<string, string>;
	errors: Record<string, string>;
	calendar: Record<string, string>;
	filters: Record<string, string>;
	filterSets: Record<string, string>;
	location: Record<string, string>;
	taskEditor: Record<string, string>;
	indexStats: Record<string, string>;
	pinnedTasks: Record<string, string>;
	table: Record<string, string>;
}

interface DenseLocalePack {
	schemaVersion: number;
	languageOrder: LangCode[];
	keyCount: number;
	keyIndex: Partial<Record<keyof LocaleData, Record<string, number>>>;
	locales: Record<LangCode, string[]>;
}

const DENSE_LOCALES = denseLocales as unknown as DenseLocalePack;
const LANGUAGE_ORDER: readonly LangCode[] = DENSE_LOCALES.languageOrder;
const LOCALE_KEY_INDEX = DENSE_LOCALES.keyIndex;
const LOCALES = DENSE_LOCALES.locales;

/** Active language state */
let currentLang: LangCode = 'en';
let currentLocale: readonly string[] = LOCALES.en;

/**
 * Initialize i18n.
 * If languageOverride is a supported language code, use that directly.
 * If languageOverride is 'auto' (or undefined), detect from Obsidian's locale.
 * Falls back to English if the detected locale isn't available.
 *
 * Spec Section 25.7: Detection flow.
 */
export function initI18n(obsidianLocale?: string, languageOverride?: string): void {
	let lang: LangCode | null = null;

	if (languageOverride && languageOverride !== 'auto' && languageOverride in LOCALES) {
		lang = languageOverride as LangCode;
	} else if (obsidianLocale) {
		lang = normalizeLocale(obsidianLocale);
	}

	if (lang && lang in LOCALES) {
		currentLang = lang;
		currentLocale = LOCALES[lang];
	} else {
		currentLang = 'en';
		currentLocale = LOCALES.en;
	}
}

/**
 * Get a translated string by category and key.
 * Supports {{variableName}} placeholder substitution.
 *
 * @param category - Locale file category (commands, notifications, etc.)
 * @param key - Translation key within the category
 * @param vars - Optional variable replacements for {{placeholders}}
 * @returns Translated string, or the key itself as fallback
 */
export function t(
	category: keyof LocaleData,
	key: string,
	vars?: Record<string, string>,
): string {
	// Try current locale first
	const index = LOCALE_KEY_INDEX[category]?.[key];
	let str = index === undefined ? undefined : currentLocale[index];

	// Fallback to English
	if (!str && currentLang !== 'en') {
		str = index === undefined ? undefined : LOCALES.en[index];
	}

	// Final fallback: return the key
	if (!str) return key;

	// Replace {{placeholders}}
	if (vars) {
		for (const [name, value] of Object.entries(vars)) {
			str = str.replace(new RegExp(`\\{\\{${name}\\}\\}`, 'g'), value);
		}
	}

	return str;
}

/** Get all available translations for a key across bundled locale files. */
export function getTranslations(category: keyof LocaleData, key: string): string[] {
	const index = LOCALE_KEY_INDEX[category]?.[key];
	if (index === undefined) return [];
	const values = LANGUAGE_ORDER
		.map(language => LOCALES[language][index])
		.filter((value): value is string => typeof value === 'string' && value.length > 0);
	return [...new Set(values)];
}

/** Get the current language code */
export function getCurrentLang(): LangCode {
	return currentLang;
}
