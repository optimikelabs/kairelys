export function normalizeTaskColorValue(value: string | null | undefined): string {
	const trimmed = (value ?? '').trim();
	if (!trimmed) return '';
	return trimmed.replace(/^#/, '');
}

export function formatTaskColorYamlValue(value: string | null | undefined): string {
	const normalized = normalizeTaskColorValue(value);
	if (!normalized) return '';
	return `#${normalized}`;
}
