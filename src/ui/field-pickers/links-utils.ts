export interface ExternalLinkValue {
	rawValue: string;
	url: string;
	displayValue: string;
	searchText: string;
	isMarkdown: boolean;
}

const MARKDOWN_HTTP_LINK_RE = /^\[([^\]]+)\]\((https?:\/\/\S+)\)$/iu;
const RAW_HTTP_URL_RE = /^https?:\/\/\S+$/iu;

export function parseExternalLinkValue(value: string | null | undefined): ExternalLinkValue | null {
	const rawValue = (value ?? '').trim();
	if (!rawValue) return null;

	const markdownMatch = rawValue.match(MARKDOWN_HTTP_LINK_RE);
	if (markdownMatch) {
		const label = markdownMatch[1]?.trim() ?? '';
		const url = markdownMatch[2]?.trim() ?? '';
		if (!label || !isSupportedExternalUrl(url)) return null;
		return buildExternalLinkValue(rawValue, url, label, true);
	}

	if (!isSupportedExternalUrl(rawValue)) return null;
	return buildExternalLinkValue(rawValue, rawValue, formatRawExternalUrlDisplay(rawValue), false);
}

export function isSupportedExternalUrl(value: string | null | undefined): boolean {
	const trimmed = (value ?? '').trim();
	return RAW_HTTP_URL_RE.test(trimmed);
}

export function formatExternalLinkDisplay(value: string | null | undefined): string {
	return parseExternalLinkValue(value)?.displayValue ?? (value ?? '').trim();
}

export function getExternalLinkUrl(value: string | null | undefined): string | null {
	return parseExternalLinkValue(value)?.url ?? null;
}

export function formatRawExternalUrlDisplay(url: string): string {
	const withoutProtocol = url.trim().replace(/^https?:\/\//iu, '');
	return withoutProtocol.replace(/\/$/u, '') || withoutProtocol;
}

function buildExternalLinkValue(
	rawValue: string,
	url: string,
	displayValue: string,
	isMarkdown: boolean,
): ExternalLinkValue {
	return {
		rawValue,
		url,
		displayValue,
		searchText: buildExternalLinkSearchText(rawValue, url, displayValue),
		isMarkdown,
	};
}

function buildExternalLinkSearchText(rawValue: string, url: string, displayValue: string): string {
	return `${displayValue} ${rawValue} ${url} ${formatRawExternalUrlDisplay(url)}`.toLocaleLowerCase();
}
