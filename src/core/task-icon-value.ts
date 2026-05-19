export function normalizeTaskIconValue(value: string | null | undefined): string {
	if (typeof value !== 'string') return '';
	const trimmed = value.trim();
	if (!trimmed) return '';
	if (trimmed.startsWith('lucide-')) {
		return trimmed.slice('lucide-'.length).trim();
	}
	return trimmed;
}
