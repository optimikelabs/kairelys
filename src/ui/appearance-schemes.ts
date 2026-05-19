import type { DropdownComponent } from 'obsidian';
import { t } from '../core/i18n';

export interface AppearanceSchemePalette {
	backgroundPrimary: string;
	backgroundSecondary: string;
	borderColor: string;
	hoverColor: string;
	textNormal: string;
	textMuted: string;
	interactiveNormal: string;
}

export type AppearanceSchemeId =
	| 'theme'
	| 'anupuccin-light'
	| 'anupuccin-dark'
	| 'catppuccin-dark'
	| 'atom-light'
	| 'atom-dark'
	| 'flexoki-light'
	| 'flexoki-dark';

const SCHEME_PALETTES: Partial<Record<AppearanceSchemeId, AppearanceSchemePalette>> = {
	// AnuPpuccin — Latte (light) / Frappé (dark)
	'anupuccin-light': {
		backgroundPrimary: '#eff1f5',
		backgroundSecondary: '#e6e9ef',
		borderColor: '#ccd0da',
		hoverColor: 'rgba(205, 214, 244, 0.075)',
		textNormal: '#4c4f69',
		textMuted: '#7c7f93',
		interactiveNormal: '#ccd0da',
	},
	'anupuccin-dark': {
		backgroundPrimary: '#303446',
		backgroundSecondary: '#292c3c',
		borderColor: '#414559',
		hoverColor: 'rgba(198, 206, 239, 0.075)',
		textNormal: '#c6ceef',
		textMuted: '#949bb7',
		interactiveNormal: '#414559',
	},

	// Catppuccin — Mocha (dark)
	'catppuccin-dark': {
		backgroundPrimary: '#1e1e2e',
		backgroundSecondary: '#181825',
		borderColor: '#313244',
		hoverColor: 'rgba(205, 214, 244, 0.075)',
		textNormal: '#cdd6f4',
		textMuted: '#a6adc8',
		interactiveNormal: '#313244',
	},

	// Atom — Light / Dark
	'atom-light': {
		backgroundPrimary: '#fafafa',
		backgroundSecondary: '#eaeaeb',
		borderColor: '#dbdbdc',
		hoverColor: 'rgba(105, 120, 198, 0.06)',
		textNormal: '#383a42',
		textMuted: '#8e8e90',
		interactiveNormal: '#eaeaeb',
	},
	'atom-dark': {
		backgroundPrimary: '#272b34',
		backgroundSecondary: '#20242b',
		borderColor: '#424958',
		hoverColor: 'rgba(113, 127, 152, 0.06)',
		textNormal: '#dcddde',
		textMuted: '#888888',
		interactiveNormal: '#20242b',
	},

	// Flexoki — Light / Dark
	'flexoki-light': {
		backgroundPrimary: '#fffcf0',
		backgroundSecondary: '#f6f4e8',
		borderColor: '#e6e4d9',
		hoverColor: 'rgba(0, 0, 0, 0.04)',
		textNormal: '#100f0f',
		textMuted: '#6f6e69',
		interactiveNormal: '#f2f0e5',
	},
	'flexoki-dark': {
		backgroundPrimary: '#100f0f',
		backgroundSecondary: '#1c1b1a',
		borderColor: '#282726',
		hoverColor: 'rgba(255, 255, 255, 0.05)',
		textNormal: '#cecdc3',
		textMuted: '#878580',
		interactiveNormal: '#1c1b1a',
	},
};

const FALLBACK_PALETTE: AppearanceSchemePalette = {
	backgroundPrimary: 'var(--background-primary)',
	backgroundSecondary: 'var(--background-secondary)',
	borderColor: 'var(--background-modifier-border)',
	hoverColor: 'var(--background-modifier-hover)',
	textNormal: 'var(--text-normal)',
	textMuted: 'var(--text-muted)',
	interactiveNormal: 'var(--interactive-normal)',
};

export function getSchemePalette(mode: AppearanceSchemeId): AppearanceSchemePalette {
	return SCHEME_PALETTES[mode] ?? FALLBACK_PALETTE;
}

export function isLightScheme(mode: AppearanceSchemeId): boolean {
	return mode.endsWith('-light');
}

export const APPEARANCE_SCHEME_OPTIONS: Array<{ value: AppearanceSchemeId; label: string }> = [
	{ value: 'theme',           label: 'App theme' },
	{ value: 'anupuccin-light', label: 'AnuPpuccin — Latte' },
	{ value: 'anupuccin-dark',  label: 'AnuPpuccin — Frappé' },
	{ value: 'catppuccin-dark', label: 'Catppuccin — Mocha' },
	{ value: 'atom-light',      label: 'Atom — Light' },
	{ value: 'atom-dark',       label: 'Atom — Dark' },
	{ value: 'flexoki-light',   label: 'Flexoki — Light' },
	{ value: 'flexoki-dark',    label: 'Flexoki — Dark' },
];

export const APPEARANCE_SCHEME_LIGHT_OPTIONS = APPEARANCE_SCHEME_OPTIONS.filter(
	o => o.value === 'theme' || o.value.endsWith('-light'),
);

export const APPEARANCE_SCHEME_DARK_OPTIONS = APPEARANCE_SCHEME_OPTIONS.filter(
	o => o.value === 'theme' || o.value.endsWith('-dark'),
);

export function getAppearanceSchemeLabel(option: { value: string; label: string }): string {
	return option.value === 'theme' ? t('settings', 'appearanceSchemeAppTheme') : option.label;
}

export function addAppearanceSchemeOptions(
	dropdown: DropdownComponent,
	options: Array<{ value: AppearanceSchemeId; label: string }>,
): void {
	for (const option of options) {
		dropdown.addOption(option.value, getAppearanceSchemeLabel(option));
	}
}
